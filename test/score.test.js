import test from "node:test";
import assert from "node:assert/strict";
import {
  computeScore,
  speedBucket,
  grade,
  PENALTY,
  CATEGORY_CAP,
} from "../src/score.js";
import {
  deriveFindings,
  submissionFindings,
  replyFindings,
} from "../src/findings.js";
import { analyzeTel, analyzeMailto, analyzeWhatsApp } from "../src/rules.js";

const f = (severity, category = "forms") => ({ severity, category });

test("score: 100 with no leaks, penalties per severity, info is free", () => {
  assert.equal(computeScore([]).score, 100);
  assert.equal(computeScore([f("info")]).score, 100);
  assert.equal(computeScore([f("critical")]).score, 100 - PENALTY.critical);
  assert.equal(
    computeScore([f("high", "forms"), f("medium", "chat"), f("low", "email")])
      .score,
    100 - 15 - 8 - 3,
  );
});

test("score: one category cannot cost more than the cap, floor is 0", () => {
  const many = Array.from({ length: 10 }, () => f("critical", "forms"));
  const r = computeScore(many);
  assert.equal(r.byCategory.forms.lost, CATEGORY_CAP);
  assert.equal(r.score, 100 - CATEGORY_CAP);
  const allAreas = [
    "forms",
    "email",
    "whatsapp",
    "chat",
    "booking",
    "mobile",
    "speed",
    "coverage",
  ].flatMap((c) => [f("critical", c), f("critical", c)]);
  assert.equal(computeScore(allAreas).score, 0);
});

test("grade bands", () => {
  assert.equal(grade(95).label, "Healthy");
  assert.equal(grade(75).label, "Leaky");
  assert.equal(grade(50).label, "Bleeding");
  assert.equal(grade(10).label, "Critical");
});

test("speed-to-lead buckets: <5 min great, <1h ok, >1h leak, none dead", () => {
  assert.equal(speedBucket(60).bucket, "great");
  assert.equal(speedBucket(299).bucket, "great");
  assert.equal(speedBucket(300).bucket, "ok");
  assert.equal(speedBucket(3599).bucket, "ok");
  assert.equal(speedBucket(3600).bucket, "leak");
  assert.equal(speedBucket(null).bucket, "dead");
  assert.equal(speedBucket(null).severity, "critical");
});

function inv(over = {}) {
  return {
    pages: [
      {
        url: "https://acme.test/",
        status: 200,
        cta: { aboveFold: true },
        horizontalOverflow: false,
      },
    ],
    forms: [],
    mailto: [],
    tel: [],
    whatsapp: [],
    booking: [],
    chat: [],
    ...over,
  };
}
const form = (o = {}) => ({
  kind: "contact",
  pages: ["https://acme.test/contact"],
  actionAttr: "/send",
  actionAbs: "https://acme.test/send",
  method: "post",
  hasOnsubmit: false,
  fields: [
    { type: "email", name: "email", visible: true },
    { type: "text", name: "name", visible: true },
  ],
  submit: { w: 120, h: 48, visible: true, covered: false },
  captcha: { present: false },
  jsErrors: [],
  required: 2,
  visibleOnMobile: true,
  ...o,
});
const ids = (list) => list.map((x) => x.id);

test("findings: empty site is a critical coverage leak", () => {
  const r = deriveFindings(inv(), {}, { origin: "https://acme.test" });
  assert.deepEqual(ids(r), ["no-lead-path"]);
  assert.equal(r[0].severity, "critical");
});

test("findings: dead form action, insecure action, JS exception", () => {
  const r = deriveFindings(
    inv({
      forms: [
        form({
          jsErrors: [
            { page: "p", class: "exception", text: "x is not defined" },
          ],
        }),
        form({
          actionAbs: "http://acme.test/x",
          actionAttr: "http://acme.test/x",
        }),
      ],
    }),
    { actions: { "https://acme.test/send": { status: 404 } } },
    { origin: "https://acme.test" },
  );
  assert.ok(ids(r).includes("form-action-dead"));
  assert.ok(ids(r).includes("form-action-insecure"));
  assert.ok(ids(r).includes("form-js-exception"));
  assert.equal(r.find((x) => x.id === "form-action-dead").severity, "critical");
});

test("findings: links, WhatsApp, chat, booking", () => {
  const r = deriveFindings(
    inv({
      mailto: [
        {
          href: "mailto:a@gone.test",
          pages: ["p"],
          analysis: analyzeMailto("mailto:a@gone.test"),
        },
        {
          href: "mailto:you@example.com",
          pages: ["p"],
          analysis: analyzeMailto("mailto:you@example.com"),
        },
      ],
      tel: [
        {
          href: "tel:0800 123 456",
          pages: ["p"],
          analysis: analyzeTel("tel:0800 123 456"),
        },
        { href: "tel:abc", pages: ["p"], analysis: analyzeTel("tel:abc") },
      ],
      whatsapp: [
        {
          href: "https://wa.me/+0123abc",
          pages: ["p"],
          analysis: analyzeWhatsApp("https://wa.me/+0123abc"),
        },
        {
          href: "https://wa.me/14155552671",
          pages: ["p"],
          analysis: analyzeWhatsApp("https://wa.me/14155552671"),
        },
      ],
      chat: [
        {
          vendor: "Tidio",
          rendered: false,
          missingOn: ["p"],
          requestFailures: [],
        },
        {
          vendor: "Crisp",
          rendered: false,
          missingOn: ["p"],
          requestFailures: [
            { url: "https://client.crisp.chat/l.js", status: 404 },
          ],
        },
        { vendor: "Drift", rendered: true },
      ],
      booking: [
        { vendor: "Calendly", href: "https://calendly.com/x", pages: ["p"] },
        { vendor: "Cal.com", href: "https://cal.com/y", pages: ["p"] },
      ],
    }),
    {
      mx: { "gone.test": { ok: false } },
      links: {
        "https://wa.me/14155552671": { ok: false, status: 404 },
        "https://calendly.com/x": { ok: false, status: 404 },
        "https://cal.com/y": { ok: false, status: 403, inconclusive: true },
      },
    },
    { origin: "https://acme.test" },
  );
  const got = ids(r);
  for (const id of [
    "mailto-no-mx",
    "mailto-invalid",
    "tel-not-international",
    "tel-invalid",
    "wa-bad-number",
    "wa-unresolved",
    "wa-no-prefill",
    "chat-not-rendered",
    "chat-script-failed",
    "booking-dead",
    "booking-unverified",
  ]) {
    assert.ok(got.includes(id), `missing ${id} in ${got}`);
  }
  assert.equal(r.find((x) => x.id === "chat-not-rendered").severity, "medium");
  assert.equal(r.find((x) => x.id === "chat-script-failed").severity, "high");
  assert.equal(r.find((x) => x.id === "booking-unverified").severity, "info");
  assert.ok(
    r.every((x) => x.fix && x.fix.length > 10),
    "every leak carries a plain-English fix",
  );
});

test("findings: mobile CTA and submit button", () => {
  const r = deriveFindings(
    inv({
      pages: [
        {
          url: "https://acme.test/",
          status: 200,
          cta: { aboveFold: false },
          horizontalOverflow: true,
        },
      ],
      forms: [
        form({ submit: { w: 60, h: 24, visible: true, covered: false } }),
      ],
    }),
    {},
    { origin: "https://acme.test" },
  );
  assert.ok(ids(r).includes("no-cta-above-fold"));
  assert.ok(ids(r).includes("mobile-overflow"));
  assert.ok(ids(r).includes("form-submit-small"));
});

test("findings: submission results map to severities", () => {
  const sub = (status, extra = {}) =>
    submissionFindings({
      status,
      label: "contact",
      page: "p",
      detail: "d",
      reason: "r",
      ...extra,
    });
  assert.equal(sub("failed")[0].severity, "critical");
  assert.equal(sub("unconfirmed")[0].severity, "high");
  assert.equal(sub("no-request")[0].severity, "high");
  assert.equal(sub("blocked-captcha")[0].severity, "info");
  assert.match(
    sub("blocked-captcha")[0].title,
    /blocked by CAPTCHA, test manually/,
  );
  assert.equal(sub("accepted")[0].severity, "info");
  assert.match(sub("accepted")[0].title, /not verified/);
  assert.equal(
    submissionFindings(
      { status: "failed", action: "a", label: "x", page: "p" },
      { deadActions: new Set(["a"]) },
    )[0].severity,
    "info",
  );
});

test("findings: reply buckets", () => {
  const r = replyFindings([
    { label: "a", page: "p", seconds: 30, waitedMinutes: 15 },
    { label: "b", page: "p", seconds: 1800, waitedMinutes: 15 },
    { label: "c", page: "p", seconds: 7200, waitedMinutes: 15 },
    { label: "d", page: "p", seconds: null, waitedMinutes: 15 },
  ]);
  assert.deepEqual(
    r.map((x) => x.severity),
    ["low", "high", "critical"],
  );
});
