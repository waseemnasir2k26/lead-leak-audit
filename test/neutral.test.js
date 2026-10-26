// Neutral fixtures (/pageN, title "Welcome"): classifier and outcome behaviour judged on the form alone.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startNeutralSites } from "./neutral-site.js";
import { runSubmit, runScan } from "../src/run.js";
import { RailError, validateOnly } from "../src/submit.js";

let sites;
const OPTS = {
  iOwn: true,
  email: "qa@example.test",
  linkCheck: false,
  mxCheck: false,
  settleMs: 150,
  maxPages: 1,
  dwellMs: 0,
  confirm: async () => true,
};
before(async () => {
  sites = await startNeutralSites();
});
after(async () => {
  await sites?.close();
});

const page = (n) => `${sites.url}page${n}`;
const dry = async (n) =>
  (await runSubmit(page(n), { ...OPTS, dryRun: true })).extra.plan.filter((p) =>
    p.page.endsWith(`/page${n}`),
  );
const run = async (n, only, extra = {}) => {
  const { extra: e, result } = await runSubmit(page(n), {
    ...OPTS,
    only: [only],
    ...extra,
  });
  return {
    sub: e.submissions.find((s) => s.page.endsWith(`/page${n}`)),
    all: e,
    result,
  };
};

for (const [n, label, reason] of [
  [1, 'forum reply ("Re:" heading, "Write your answer")', /re:|answer|reply/i],
  [
    2,
    'donation (number field "sum" and $10/$25 radios)',
    /amount|number field|\$/i,
  ],
  [3, 'RSVP (select "response" Yes/No)', /yes\/no|attending/i],
  [4, "rating / score range input", /score|number field/i],
  [5, 'unknown number input ("headcount")', /number field/i],
]) {
  test(`neutral: ${label} is rejected with a reason and nothing is sent`, async () => {
    const before = sites.posts.length;
    const rows = await dry(n);
    assert.ok(rows.length >= 1);
    for (const r of rows) {
      assert.equal(r.status, "skipped", JSON.stringify(r));
      assert.match(r.reason, reason);
    }
    assert.equal(sites.posts.length, before);
  });
}

test('neutral: multi-step form (hidden card fields, "Next" button) is rejected with the exact reason', async () => {
  const [r] = await dry(14);
  assert.equal(r.status, "skipped");
  assert.match(
    r.reason,
    /multi-step form \(step 2 looks like payment\): test manually/,
  );
});

test('neutral: the positive control (heading "Contact us", message box, email + phone) is accepted and submitted once', async () => {
  const [r] = await dry(6);
  assert.equal(r.status, "would-submit");
  sites.posts.length = 0;
  const { sub } = await run(6, "/post/ok");
  assert.equal(sub.status, "accepted", JSON.stringify(sub));
  assert.equal(sites.posts.filter((p) => p === "/post/ok").length, 1);
});

test('neutral: a visible "leave this field blank" field is never filled', async () => {
  sites.bodies.length = 0;
  const { sub } = await run(7, "/post/ok");
  assert.equal(sub.status, "accepted");
  const body = sites.bodies.at(-1).body;
  assert.equal(body.extra ?? "", "", "the visible honeypot must stay empty");
  assert.equal(body.name, "LEAD-LEAK-AUDIT TEST");
});

test("neutral: unknown number inputs are never filled (valueFor)", async () => {
  const { valueFor } = await import("../src/submit.js");
  const ctx = { email: "a@b.test", message: "m", today: "2026-01-01" };
  const f = (o) => ({
    i: 0,
    tag: "input",
    type: "number",
    name: "",
    id: "",
    label: "",
    placeholder: "",
    visible: true,
    required: false,
    ...o,
  });
  assert.equal(valueFor(f({ name: "sum" }), ctx).action, "skip");
  assert.equal(
    valueFor(f({ name: "sum", required: true }), ctx).action,
    "unfillable",
  );
  assert.equal(valueFor(f({ name: "staff_count" }), ctx).action, "fill");
});

test('outcome: a blank 200 is "unconfirmed", never "accepted"', async () => {
  const { sub } = await run(8, "/post/blank");
  assert.equal(sub.status, "unconfirmed", JSON.stringify(sub));
  assert.match(sub.detail, /no positive evidence of delivery/);
});

test('outcome: a PHP fatal-error body is "unconfirmed" with a server-error flag, and says so', async () => {
  const { sub, result } = await run(9, "/post/fatal");
  assert.equal(sub.status, "unconfirmed", JSON.stringify(sub));
  assert.ok(sub.serverError);
  assert.match(sub.detail, /crash page/);
  assert.ok(result.findings.some((f) => f.id === "submit-error-body"));
});

test('outcome: a page without the form and without any thank-you is "unconfirmed"', async () => {
  const { sub } = await run(10, "/post/plain");
  assert.equal(sub.status, "unconfirmed");
  assert.match(sub.detail, /no thank-you message and no thank-you page/);
});

test('outcome: a 302 to a foreign host after the POST is "accepted-redirect-blocked", with no false network error', async () => {
  sites.foreignHits.length = 0;
  const { sub, result } = await run(11, "/post/redir302");
  assert.equal(sub.status, "accepted-redirect-blocked", JSON.stringify(sub));
  assert.match(
    sub.detail,
    /^received by your server \(HTTP 302\); the follow-up redirect to 127\.0\.0\.1:\d+\/after was blocked by the safety rail/,
  );
  assert.deepEqual(sub.networkErrors, []);
  assert.ok(!result.findings.some((f) => f.id === "submit-network-error"));
  assert.deepEqual(sites.foreignHits, []);
});

test("outcome: a JS redirect to /cart after a fetch 200 is reported truthfully and /cart is never requested", async () => {
  sites.gets.length = 0;
  const { sub } = await run(12, "#jf");
  assert.equal(sub.status, "accepted-redirect-blocked", JSON.stringify(sub));
  assert.match(
    sub.detail,
    /^received by your server \(HTTP 200\); the follow-up navigation to \/cart was blocked by the safety rail/,
  );
  assert.ok(!sites.gets.includes("/cart"));
});

test('outcome: a meta refresh to another host is the same truthful wording, never "saw a confirmation on /"', async () => {
  sites.foreignHits.length = 0;
  const { sub } = await run(13, "/post/meta");
  assert.equal(sub.status, "accepted-redirect-blocked", JSON.stringify(sub));
  assert.match(
    sub.detail,
    /^received by your server \(HTTP 200\); the follow-up navigation to 127\.0\.0\.1:\d+\/meta was blocked by the safety rail/,
  );
  assert.ok(!/saw a confirmation/.test(sub.detail));
  assert.deepEqual(sites.foreignHits, []);
});

test("outcome: accepted-redirect-blocked leads are included in the IMAP wait, and a reply is positive evidence", async () => {
  process.env.LLA_IMAP_HOST = "imap.example.test";
  process.env.LLA_IMAP_USER = "u";
  process.env.LLA_IMAP_PASS = "neutral-pass-123";
  try {
    let ids = [];
    const { extra } = await runSubmit(page(11), {
      ...OPTS,
      only: ["/post/redir302"],
      imap: true,
      waitMinutes: 1,
      pollMs: 10,
      imapClientFactory: async () => {
        ids = sites.bodies
          .map((b) => /LLA-[0-9a-f]{8}/.exec(b.body.message || "")?.[0])
          .filter(Boolean);
        return {
          listMessages: async () =>
            ids.map((id) => ({
              date: new Date(Date.now() + 5000),
              text: `reply ${id}`,
            })),
          close: async () => {},
        };
      },
    });
    assert.equal(extra.replies.length, 1);
    assert.equal(extra.replies[0].bucket, "great");
    assert.equal(extra.deliveryVerified, true);
    assert.equal(
      extra.submissions.find((s) => s.leadId === extra.replies[0].leadId)?.status,
      "delivered",
    );
  } finally {
    for (const k of ["LLA_IMAP_HOST", "LLA_IMAP_USER", "LLA_IMAP_PASS"])
      delete process.env[k];
  }
});

test('reports say "delivery unverified without --imap"', async () => {
  const { all } = await run(6, "/post/ok");
  const { buildReport, renderHtml } = await import("../src/report.js");
  const { result } = await runScan(page(6), {
    linkCheck: false,
    mxCheck: false,
    settleMs: 150,
    maxPages: 1,
  });
  const report = buildReport(result, all);
  assert.match(report.deliveryNote, /Delivery unverified without --imap/);
  assert.match(renderHtml(report), /Delivery unverified without --imap/);
  assert.equal(report.deliveryVerified, false);
});

test("time trap: a submit within 2.5 s of load is swallowed; the dwell and human-pace typing get past it", async () => {
  sites.posts.length = 0;
  const fast = await run(18, "/post/ok", { dwellMs: 0 });
  assert.equal(fast.sub.status, "no-request", JSON.stringify(fast.sub));
  assert.equal(sites.posts.length, 0);
  const slow = await run(18, "/post/ok", { dwellMs: 3000 });
  assert.equal(slow.sub.status, "accepted", JSON.stringify(slow.sub));
  // the human-pace typing really typed every field (no silent per-field errors)
  assert.match(sites.bodies.at(-1).body.message || '', /LLA-[0-9a-f]{8}/);
  assert.equal(sites.bodies.at(-1).body.name, 'LEAD-LEAK-AUDIT TEST');
  assert.ok(slow.sub.plan.every((p) => !p.error), JSON.stringify(slow.sub.plan));
  assert.equal(sites.posts.length, 1);
});

test("frames: a form inside a same-origin iframe is scanned and submitted", async () => {
  sites.posts.length = 0;
  const { sub } = await run(15, "/post/frame");
  assert.equal(sub.status, "accepted", JSON.stringify(sub));
  assert.deepEqual(sites.posts, ["/post/frame"]);
});

test("frames: a cross-origin embedded form is an info finding, and the page still counts as having a lead path", async () => {
  const { result } = await runScan(page(16), {
    linkCheck: false,
    mxCheck: false,
    settleMs: 300,
    maxPages: 1,
  });
  assert.ok(
    result.findings.some(
      (f) => f.id === "embedded-third-party-form" && f.severity === "info",
    ),
  );
  assert.ok(
    !result.findings.some((f) => f.id === "no-lead-path"),
    "an embedded form is a lead path",
  );
});

test('--only: "", "/", "." and other broad values are refused before anything happens', async () => {
  for (const bad of ["", " ", "/", ".", "#", "0", "api", "/p"])
    assert.throws(() => validateOnly([bad]), RailError, JSON.stringify(bad));
  for (const good of ["2", "#jf", ".contact", "/post/ok"])
    assert.equal(validateOnly([good]), true);
  const before = sites.posts.length;
  await assert.rejects(
    runSubmit(page(6), { ...OPTS, yes: true, confirm: null, only: [""] }),
    (e) => e instanceof RailError && /too broad/.test(e.message),
  );
  await assert.rejects(
    runSubmit(page(6), { ...OPTS, yes: true, confirm: null, only: ["/"] }),
    RailError,
  );
  assert.equal(sites.posts.length, before);
});

test('outcome: "Thanks for your message, but it could not be sent. Please try again." is unconfirmed, never accepted', async () => {
  const { sub } = await run(19, "/post/err-both");
  assert.equal(sub.status, "unconfirmed", JSON.stringify(sub));
  assert.notEqual(sub.status, "accepted");
});

test('outcome: "Thank you! Your message has been sent." is accepted', async () => {
  const { sub } = await run(21, "/post/ok-sent");
  assert.equal(sub.status, "accepted", JSON.stringify(sub));
  assert.equal(sub.confirmation, "message");
});

test('outcome: "Error: please try again" is error-message', async () => {
  const { sub } = await run(20, "/post/err-only");
  assert.equal(sub.status, "error-message", JSON.stringify(sub));
});

test("probe: a 404 on the GET/HEAD probe of a POST-only action is info when a real POST was sent, and the POST result counts", async () => {
  sites.posts.length = 0;
  const { sub, result } = await run(22, "/post/postonly");
  assert.equal(sub.status, "accepted", JSON.stringify(sub));
  assert.ok(sites.posts.includes("/post/postonly"));
  assert.ok(!result.findings.some((f) => f.id === "form-action-dead"));
  assert.ok(!result.findings.some((f) => /every submission is lost/i.test(f.detail)));
  const probe = result.findings.find((f) => f.id === "form-action-probe-info");
  assert.ok(probe, "info finding expected");
  assert.equal(probe.severity, "info");
  assert.match(probe.title, /GET not allowed on the form endpoint, normal for POST-only handlers/);
});

test('probe: with no POST tested (scan only), a 404 on the form action stays critical and may say every submission is lost', async () => {
  const { result } = await runScan(page(22), {
    linkCheck: false,
    mxCheck: false,
    settleMs: 150,
    maxPages: 1,
  });
  const dead = result.findings.find((f) => f.id === "form-action-dead");
  assert.ok(dead, "dead-action finding expected without a POST");
  assert.equal(dead.severity, "critical");
  assert.match(dead.detail, /every submission is lost/i);
});
