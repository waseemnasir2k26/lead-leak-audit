import test from "node:test";
import assert from "node:assert/strict";
import {
  checkRails,
  assertHostAllowed,
  RailError,
  planSubmissions,
  planForm,
  valueFor,
  classifyOutcome,
  newLeadId,
  testMessage,
  TEST_NAME,
  HARD_MAX_FORMS,
} from "../src/submit.js";

const allowed = new Set(["acme.test"]);
const field = (o) => ({
  i: 0,
  tag: "input",
  type: "text",
  name: "",
  id: "",
  label: "",
  placeholder: "",
  required: false,
  visible: true,
  honeypot: false,
  ...o,
});
const mkForm = (o = {}) => ({
  sig: "sig" + Math.random(),
  kind: "contact",
  firstPage: "https://acme.test/contact",
  actionAbs: "https://acme.test/send",
  method: "post",
  captcha: { present: false },
  fields: [
    field({ i: 0, name: "name", required: true }),
    field({ i: 1, name: "email", type: "email", required: true }),
    field({ i: 2, name: "message", tag: "textarea", type: "textarea" }),
    field({ i: 3, name: "website_url", visible: false, honeypot: true }),
  ],
  ...o,
});
const inv = (forms) => ({ forms });

test("rails: refuses without --i-own-this-site", () => {
  assert.throws(
    () => checkRails({ url: "https://acme.test", email: "qa@acme.test" }),
    RailError,
  );
  assert.throws(
    () =>
      checkRails({
        url: "https://acme.test",
        iOwn: false,
        email: "qa@acme.test",
      }),
    /--i-own-this-site/,
  );
  assert.throws(
    () =>
      checkRails({
        url: "https://acme.test",
        iOwn: "yes",
        email: "qa@acme.test",
      }),
    RailError,
    "only literal true counts",
  );
});

test("rails: needs a valid test inbox", () => {
  assert.throws(
    () => checkRails({ url: "https://acme.test", iOwn: true }),
    /--email/,
  );
  assert.throws(
    () => checkRails({ url: "https://acme.test", iOwn: true, email: "nope" }),
    RailError,
  );
});

test("rails: allowed hosts are the url host plus --allow-domain; www is equivalent", () => {
  const r = checkRails({
    url: "https://www.acme.test/x",
    iOwn: true,
    email: "qa@acme.test",
    allowDomains: ["api.acme.test"],
  });
  assert.deepEqual([...r.allowed].sort(), ["acme.test", "api.acme.test"]);
  assert.equal(assertHostAllowed("acme.test", r.allowed), true);
  assert.throws(() => assertHostAllowed("evil.test", r.allowed), RailError);
  assert.throws(
    () => assertHostAllowed("acme.test.evil.test", r.allowed),
    RailError,
  );
});

test("plan: a form posting to a foreign domain is skipped, not submitted", () => {
  const out = planSubmissions(
    inv([mkForm({ actionAbs: "https://forms.other.test/s" })]),
    { email: "qa@acme.test", allowed },
  );
  assert.equal(out[0].status, "skipped");
  assert.match(out[0].reason, /not the audited host/);
  const ok = planSubmissions(
    inv([mkForm({ actionAbs: "https://forms.other.test/s" })]),
    {
      email: "qa@acme.test",
      allowed: new Set(["acme.test", "forms.other.test"]),
    },
  );
  assert.equal(ok[0].status, "planned");
});

test("plan: CAPTCHA forms are marked blocked and never planned", () => {
  const out = planSubmissions(
    inv([
      mkForm({ captcha: { present: true, kind: "reCAPTCHA", scope: "form" } }),
    ]),
    { email: "qa@acme.test", allowed },
  );
  assert.equal(out[0].status, "blocked-captcha");
  assert.match(out[0].reason, /Blocked by CAPTCHA, test manually/);
  assert.equal(out[0].plan, undefined);
});

test("plan: one slot per form, search/login never submitted, hard cap of 10", () => {
  const forms = Array.from({ length: 14 }, (_, i) => mkForm({ sig: "s" + i }));
  forms.push(
    mkForm({ kind: "login", sig: "login" }),
    mkForm({ kind: "search", sig: "search" }),
  );
  const out = planSubmissions(inv(forms), {
    email: "qa@acme.test",
    allowed,
    maxForms: 999,
  });
  assert.equal(
    out.filter((o) => o.status === "planned").length,
    HARD_MAX_FORMS,
  );
  assert.equal(
    out.filter((o) => o.status === "planned" && o.leadId).length,
    HARD_MAX_FORMS,
  );
  assert.equal(
    new Set(out.filter((o) => o.status === "planned").map((o) => o.sig)).size,
    HARD_MAX_FORMS,
    "each form appears once",
  );
  assert.equal(out.find((o) => o.sig === "login").status, "skipped");
  assert.equal(out.find((o) => o.sig === "search").status, "skipped");
  assert.equal(out.filter((o) => /cap/.test(o.reason || "")).length, 4);
  const few = planSubmissions(inv(forms), {
    email: "qa@acme.test",
    allowed,
    maxForms: 3,
  });
  assert.equal(few.filter((o) => o.status === "planned").length, 3);
});

test("plan: test lead is clearly marked and carries a unique ID; honeypot stays empty", () => {
  const [p] = planSubmissions(inv([mkForm()]), {
    email: "qa@acme.test",
    allowed,
  });
  const by = Object.fromEntries(p.plan.map((x) => [x.field, x]));
  assert.equal(by.name.value, TEST_NAME);
  assert.equal(by.email.value, "qa@acme.test");
  assert.match(by.message.value, /automated test of my own website/);
  assert.ok(by.message.value.includes(p.leadId));
  assert.match(p.leadId, /^LLA-[0-9a-f]{8}$/);
  assert.equal(by.website_url.action, "skip");
  assert.match(by.website_url.why, /honeypot/);
});

test("plan: ID travels in the name when the form has no message field", () => {
  const f = mkForm({
    fields: [
      field({ i: 0, name: "name", required: true }),
      field({ i: 1, name: "email", type: "email", required: true }),
    ],
  });
  const plan = planForm(f, { email: "qa@acme.test", leadId: "LLA-deadbeef" });
  assert.equal(plan[0].value, `${TEST_NAME} LLA-deadbeef`);
});

test("values: selects, required checkboxes, files, phone numbers", () => {
  const ctx = {
    email: "qa@acme.test",
    message: testMessage("LLA-1"),
    today: "2026-10-24",
  };
  assert.deepEqual(
    valueFor(
      field({
        tag: "select",
        type: "select",
        options: [
          { value: "", disabled: false },
          { value: "a", disabled: false },
        ],
      }),
      ctx,
    ),
    { action: "select", value: "a" },
  );
  assert.equal(
    valueFor(field({ type: "checkbox", required: true }), ctx).action,
    "check",
  );
  assert.equal(valueFor(field({ type: "checkbox" }), ctx).action, "skip");
  assert.equal(
    valueFor(field({ type: "file", required: true }), ctx).action,
    "unfillable",
  );
  assert.equal(valueFor(field({ type: "tel" }), ctx).value, "+15555550100");
  assert.equal(
    valueFor(field({ name: "first_name" }), ctx).value,
    "LEAD-LEAK-AUDIT",
  );
  assert.equal(valueFor(field({ type: "password" }), ctx).action, "skip");
});

test("lead IDs are unique", () => {
  assert.notEqual(newLeadId(), newLeadId());
});

const base = {
  startUrl: "https://acme.test/contact",
  finalUrl: "https://acme.test/contact",
  textBefore: "Contact us",
  textAfter: "Contact us",
};
test("outcome: HTTP error means the lead was lost", () => {
  const o = classifyOutcome({
    ...base,
    relevant: [
      { method: "POST", url: "https://acme.test/api/missing", status: 404 },
    ],
  });
  assert.equal(o.status, "failed");
  assert.equal(o.http, 404);
});
test("outcome: redirect to a thank-you page is delivered", () => {
  const o = classifyOutcome({
    ...base,
    finalUrl: "https://acme.test/thanks.html",
    textAfter: "Thank you. We received your message",
    relevant: [
      { method: "POST", url: "https://acme.test/api/lead", status: 303 },
      { method: "GET", url: "https://acme.test/thanks.html", status: 200 },
    ],
  });
  assert.equal(o.status, "delivered");
  assert.equal(o.redirect, "https://acme.test/thanks.html");
});
test("outcome: 200 with nothing shown is unconfirmed", () => {
  const o = classifyOutcome({
    ...base,
    relevant: [{ method: "POST", url: "https://acme.test/s", status: 200 }],
  });
  assert.equal(o.status, "unconfirmed");
});
test("outcome: inline success message is delivered; error text is an error", () => {
  assert.equal(
    classifyOutcome({
      ...base,
      textAfter: "Contact us\nMessage sent, thanks!",
      relevant: [{ method: "POST", url: "https://acme.test/s", status: 200 }],
    }).status,
    "delivered",
  );
  assert.equal(
    classifyOutcome({
      ...base,
      textAfter: "Contact us\nSomething went wrong, try again",
      relevant: [{ method: "POST", url: "https://acme.test/s", status: 200 }],
    }).status,
    "error-message",
  );
});
test("outcome: no request, validation block, network failure, foreign block", () => {
  assert.equal(classifyOutcome({ ...base, relevant: [] }).status, "no-request");
  assert.equal(
    classifyOutcome({ ...base, relevant: [], validationBlocked: true }).status,
    "client-validation",
  );
  assert.equal(
    classifyOutcome({
      ...base,
      relevant: [
        {
          method: "POST",
          url: "https://acme.test/s",
          status: null,
          failed: true,
          error: "net::ERR_FAILED",
        },
      ],
    }).status,
    "failed",
  );
  assert.equal(
    classifyOutcome({
      ...base,
      relevant: [],
      blockedForeign: ["hooks.other.test"],
    }).status,
    "skipped",
  );
  assert.equal(
    classifyOutcome({
      ...base,
      textAfter: "Contact us\nThank you!",
      relevant: [],
    }).status,
    "unconfirmed",
  );
});
test("outcome: success text that was already on the page does not count", () => {
  const o = classifyOutcome({
    ...base,
    textBefore: "Thank you for visiting",
    textAfter: "Thank you for visiting",
    relevant: [{ method: "POST", url: "https://acme.test/s", status: 200 }],
  });
  assert.equal(o.status, "unconfirmed");
});
