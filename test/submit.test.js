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
  heading: "Contact us",
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
    mkForm({ sig: "login", fields: [...mkForm().fields, field({ i: 9, type: "password", name: "pw" })] }),
    mkForm({ sig: "search", fields: [field({ i: 0, type: "search", name: "q" })] }),
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
test("outcome: redirect to a thank-you page is accepted", () => {
  const o = classifyOutcome({
    ...base,
    finalUrl: "https://acme.test/thanks.html",
    textAfter: "Thank you. We received your message",
    relevant: [
      { method: "POST", url: "https://acme.test/api/lead", status: 303 },
      { method: "GET", url: "https://acme.test/thanks.html", status: 200 },
    ],
  });
  assert.equal(o.status, "accepted");
  assert.equal(o.redirect, "https://acme.test/thanks.html");
});
test("outcome: 200 with nothing shown is unconfirmed", () => {
  const o = classifyOutcome({
    ...base,
    relevant: [{ method: "POST", url: "https://acme.test/s", status: 200 }],
  });
  assert.equal(o.status, "unconfirmed");
});
test("outcome: inline success message is accepted; error text is an error", () => {
  assert.equal(
    classifyOutcome({
      ...base,
      textAfter: "Contact us\nMessage sent, thanks!",
      relevant: [{ method: "POST", url: "https://acme.test/s", status: 200 }],
    }).status,
    "accepted",
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

// Outcome levels: "accepted" = positive evidence AND no negative cue. "delivered" is never produced here (IMAP only).
const POST200 = [{ method: "POST", url: "https://acme.test/s", status: 200 }];
const outcomeOf = (textAfter, extra = {}) =>
  classifyOutcome({ ...base, textAfter, relevant: POST200, ...extra });
test("outcome: a success message with no negative cue is accepted, never delivered", () => {
  const o = outcomeOf("Thank you! Your message has been sent.");
  assert.equal(o.status, "accepted");
  assert.match(o.detail, /Accepted by the site, not verified: run with --imap to confirm delivery/);
});
test("outcome: a negative cue beside success wording is unconfirmed; alone it is error-message", () => {
  assert.equal(
    outcomeOf("Thanks for your message. There was an error sending it.").status,
    "unconfirmed",
  );
  assert.equal(
    outcomeOf("Thank you. Your message was not delivered.").status,
    "unconfirmed",
  );
  assert.equal(
    outcomeOf("Gracias. Error al enviar el mensaje").status,
    "unconfirmed",
  );
  assert.equal(outcomeOf("Your message was not delivered.").status, "error-message");
  assert.equal(outcomeOf("Il y a eu un échec, merci").status, "unconfirmed");
  assert.equal(outcomeOf("Leider ist ein Fehler aufgetreten").status, "error-message");
  assert.equal(outcomeOf("Erro ao enviar, obrigado").status, "unconfirmed");
});
test("outcome: negative words only count as whole words (knot, Note, nothing do not trip)", () => {
  assert.equal(outcomeOf("Thanks! Your note is in the knot of nothing").status, "accepted");
});
test("outcome: 'invalid' alone is not a negative cue; 'invalid email' is", () => {
  assert.equal(outcomeOf("Thanks! Your message has been sent. Invalid").status, "accepted");
  assert.equal(
    outcomeOf("Thanks! Your message has been sent. Invalid email address.").status,
    "unconfirmed",
  );
  assert.equal(
    outcomeOf("Invalid email address. Please try again.").status,
    "error-message",
  );
});
test("outcome: 'spam' alone is not a negative cue; 'marked as spam' is", () => {
  assert.equal(
    outcomeOf("Thanks! Message sent. Check your spam folder.").status,
    "accepted",
  );
  assert.equal(
    outcomeOf("Thanks! Message sent. It was marked as spam.").status,
    "unconfirmed",
  );
});
test("outcome: JSON ok:false is error-message whatever the text says", () => {
  const o = classifyOutcome({
    ...base,
    textAfter: '{"ok":false,"message":"Thank you for your message"}',
    relevant: [
      {
        method: "POST",
        url: "https://acme.test/api/lead",
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: '{"ok":false,"message":"Thank you for your message"}',
      },
    ],
  });
  assert.equal(o.status, "error-message");
});
test("outcome: JSON error key with content is error-message; an empty error key is not", () => {
  const json = (body) =>
    classifyOutcome({
      ...base,
      textAfter: body,
      relevant: [
        { method: "POST", url: "https://acme.test/api/lead", status: 200, contentType: "application/json", body },
      ],
    }).status;
  assert.equal(json('{"errors":{"email":["Bad"]},"message":"Thanks"}'), "error-message");
  assert.equal(json('{"error":"Could not save"}'), "error-message");
  assert.equal(json('{"status":"error","message":"Thanks"}'), "error-message");
  assert.equal(json('{"success":false}'), "error-message");
  assert.equal(json('{"error":"","errors":[],"success":true,"message":"Thanks, we received it"}'), "accepted");
});
test("outcome: JSON ok:true with no error is positive evidence, unless the JSON text has a negative cue", () => {
  const json = (body) =>
    classifyOutcome({
      ...base,
      textAfter: body,
      relevant: [
        { method: "POST", url: "https://acme.test/api/lead", status: 200, contentType: "application/json", body },
      ],
    }).status;
  assert.equal(json('{"ok":true}'), "accepted");
  assert.equal(json('{"ok":true,"message":"Saved, but the email was not sent"}'), "unconfirmed");
});
test("outcome: a non-JSON body is read as text even when the header says JSON", () => {
  const o = classifyOutcome({
    ...base,
    textAfter: "Thank you! Your message has been sent.",
    relevant: [
      { method: "POST", url: "https://acme.test/s", status: 200, contentType: "application/json", body: "<html>" },
    ],
  });
  assert.equal(o.status, "accepted");
});

// A 3xx only proves the server answered. Redirect to a foreign host after the POST: unconfirmed, never accepted.
test("outcome: 302 to a foreign host after the POST is unconfirmed, with a manual-check instruction", () => {
  const o = classifyOutcome({
    ...base,
    relevant: [{ method: "POST", url: "https://acme.test/s", status: 302 }],
    blockedRedirects: [{ host: "pay.other.test", kind: "foreign", path: "/thanks", status: 302 }],
  });
  assert.equal(o.status, "unconfirmed");
  assert.match(
    o.detail,
    /^unconfirmed: the site redirected to pay\.other\.test, which the safety rail blocked \(HTTP 302\)\. .*Check that host's thank-you page manually\./,
  );
  assert.equal(o.redirectBlocked, true);
});
test("outcome: 302 to the SAME host followed by a thank-you page is accepted", () => {
  const o = classifyOutcome({
    ...base,
    finalUrl: "https://acme.test/thank-you",
    textAfter: "Thanks, we have your message.",
    relevant: [
      { method: "POST", url: "https://acme.test/s", status: 302 },
      { method: "GET", url: "https://acme.test/thank-you", status: 200 },
    ],
  });
  assert.equal(o.status, "accepted");
  assert.equal(o.redirectBlocked, undefined);
});
