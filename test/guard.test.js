import test from "node:test";
import assert from "node:assert/strict";
import { forbiddenEndpoint } from "../src/guard.js";
import { forbiddenForm, classifyForm } from "../src/rules.js";
import { classifyOutcome, planSubmissions } from "../src/submit.js";
import { parseRobots } from "../src/net.js";

const U = (p) => `https://acme.test${p}`;

test("endpoint gate: forbidden paths by their real URL", () => {
  const cases = {
    comment: [
      "/wp-comments-post.php",
      "/blog/comment",
      "/post/12/comments",
      "/index.php?comment=1",
    ],
    commerce: [
      "/cart",
      "/cart/add",
      "/?add-to-cart=12",
      "/checkout/",
      "/shop/order",
      "/orders/5",
      "/payment",
      "/pay",
      "/wc-ajax=add_to_cart",
      "/basket/add",
    ],
    account: [
      "/unsubscribe",
      "/newsletter/unsubscribe?id=1",
      "/delete",
      "/account/delete",
      "/my-account",
      "/register",
      "/password/reset",
      "/lost-password",
      "/login",
      "/wp-login.php",
      "/sign-in",
      "/reset",
      "/profile",
    ],
  };
  for (const [kind, paths] of Object.entries(cases)) {
    for (const p of paths)
      assert.equal(
        forbiddenEndpoint(U(p))?.kind,
        kind,
        `${p} should be ${kind}`,
      );
  }
  assert.equal(forbiddenEndpoint(U("/signup")).kind, "account");
  assert.equal(forbiddenEndpoint(U("/signup"), { allowSignup: true }), null);
});

test("endpoint gate: ordinary contact endpoints pass", () => {
  for (const p of [
    "/api/lead",
    "/contact",
    "/contact-us",
    "/wp-admin/admin-ajax.php?action=cf7",
    "/wp-json/contact-form-7/v1/contact-forms/1/feedback",
    "/forms/submit",
    "/send.php",
    "/cartography",
    "/ordering-info",
    "/discount",
  ]) {
    assert.equal(forbiddenEndpoint(U(p)), null, p);
  }
});

test("endpoint gate: robots.txt is checked on the real path", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /private/\n");
  assert.equal(
    forbiddenEndpoint(U("/private/collect"), { robots }).kind,
    "robots",
  );
  assert.equal(forbiddenEndpoint(U("/open/collect"), { robots }), null);
  assert.equal(forbiddenEndpoint("mailto:a@b.test"), null);
});

const fld = (o) => ({
  i: 0,
  tag: "input",
  type: "text",
  name: "",
  id: "",
  label: "",
  placeholder: "",
  autocomplete: "",
  required: false,
  visible: true,
  honeypot: false,
  ...o,
});
const base = () => ({
  kind: "contact",
  sig: "s",
  actionAbs: U("/api/lead"),
  id: "f",
  name: "",
  className: "",
  method: "post",
  firstPage: U("/c"),
  captcha: { present: false },
  submitActions: [],
  fields: [
    fld({ name: "name" }),
    fld({ type: "email", name: "email" }),
    fld({ tag: "textarea", type: "textarea", name: "message" }),
  ],
});

test("DOM classifier considers every submit button formaction", () => {
  assert.equal(forbiddenForm(base()), null);
  for (const [path, kind] of [
    ["/wp-comments-post.php", "comment"],
    ["/cart/add", "commerce"],
    ["/unsubscribe", "account"],
  ]) {
    const f = {
      ...base(),
      submitActions: [
        { action: null, method: "" },
        { action: U(path), method: "post" },
      ],
    };
    assert.equal(forbiddenForm(f)?.kind, kind, path);
    assert.equal(classifyForm(f), kind);
  }
});

test('DOM classifier sees fields attached through form="id" (they arrive in form.fields)', () => {
  const f = {
    ...base(),
    fields: [
      ...base().fields,
      fld({ type: "password", name: "pw", visible: true }),
    ],
  };
  assert.equal(classifyForm(f), "login");
  const g = {
    ...base(),
    fields: [
      ...base().fields,
      fld({ type: "hidden", name: "comment_post_ID", visible: false }),
    ],
  };
  assert.equal(classifyForm(g), "comment");
});

test("plan: formaction to a forbidden or robots-disallowed endpoint is skipped before any browser work", () => {
  const allowed = new Set(["acme.test"]);
  const robots = parseRobots("User-agent: *\nDisallow: /private/\n");
  const f = {
    ...base(),
    submitActions: [{ action: U("/private/collect"), method: "post" }],
  };
  const [r] = planSubmissions(
    { forms: [f] },
    { email: "qa@acme.test", allowed, robots },
  );
  assert.equal(r.status, "skipped");
  assert.match(r.reason, /blocked: forbidden endpoint \/private\/collect/);
  const g = {
    ...base(),
    kind: "contact",
    actionAbs: U("/api/lead"),
    submitActions: [{ action: U("/cart/add"), method: "post" }],
  };
  const [q] = planSubmissions(
    { forms: [{ ...g, kind: classifyForm(g) }] },
    { email: "qa@acme.test", allowed },
  );
  assert.equal(q.status, "skipped");
});

test('outcome: a request blocked at the network layer means "not submitted", whatever else happened', () => {
  const o = classifyOutcome({
    relevant: [
      {
        method: "POST",
        url: U("/wp-comments-post.php"),
        status: null,
        failed: true,
        error: "net::ERR_BLOCKED_BY_CLIENT",
      },
    ],
    blockedForbidden: ["/wp-comments-post.php"],
    startUrl: U("/c"),
    finalUrl: U("/c"),
    textBefore: "a",
    textAfter: "a",
  });
  assert.equal(o.status, "skipped");
  assert.match(
    o.detail,
    /^blocked: forbidden endpoint \/wp-comments-post\.php/,
  );
  assert.match(o.detail, /not submitted/);
});
