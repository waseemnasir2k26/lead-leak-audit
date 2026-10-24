// Never-submit kinds, allow-list, --only, newsletter default, robots, port-aware host comparison.
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyForm,
  forbiddenForm,
  leadEligibility,
  hostKey,
} from "../src/rules.js";
import {
  planSubmissions,
  matchesOnly,
  checkRails,
  assertHostAllowed,
  RailError,
} from "../src/submit.js";
import { parseRobots } from "../src/net.js";

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
const email = fld({ type: "email", name: "email" });
const name = fld({ name: "name" });
const msg = fld({ tag: "textarea", type: "textarea", name: "message" });
const form = (o = {}) => ({
  sig: "s" + Math.random(),
  kind: "contact",
  actionAbs: "https://acme.test/send",
  id: "",
  name: "",
  className: "",
  method: "post",
  firstPage: "https://acme.test/c",
  captcha: { present: false },
  fields: [name, email, msg],
  ...o,
});
const allowed = new Set(["acme.test"]);
const plan = (forms, opts = {}) =>
  planSubmissions(
    { forms: forms.map((f) => ({ ...f, kind: f.kind || classifyForm(f) })) },
    { email: "qa@acme.test", allowed, ...opts },
  );

const NEVER = [
  [
    "comment (wp-comments-post)",
    form({
      actionAbs: "https://acme.test/wp-comments-post.php",
      id: "commentform",
    }),
    "comment",
  ],
  [
    "comment (comment_post_ID field)",
    form({
      fields: [
        name,
        email,
        msg,
        fld({ type: "hidden", name: "comment_post_ID", visible: false }),
      ],
    }),
    "comment",
  ],
  [
    "cart (add-to-cart action)",
    form({ actionAbs: "https://acme.test/?add-to-cart=12" }),
    "commerce",
  ],
  [
    "cart (/cart path)",
    form({ actionAbs: "https://acme.test/cart/update" }),
    "commerce",
  ],
  ["checkout", form({ actionAbs: "https://acme.test/checkout" }), "commerce"],
  [
    "lone quantity input",
    form({
      actionAbs: "https://acme.test/x",
      fields: [fld({ type: "number", name: "quantity" })],
    }),
    "commerce",
  ],
  [
    "card number field",
    form({ fields: [name, email, fld({ name: "card-number" })] }),
    "commerce",
  ],
  [
    "cc autocomplete",
    form({
      fields: [name, email, fld({ name: "f1", autocomplete: "cc-number" })],
    }),
    "commerce",
  ],
  [
    "unsubscribe",
    form({ actionAbs: "https://acme.test/unsubscribe", fields: [email] }),
    "account",
  ],
  [
    "delete account",
    form({ actionAbs: "https://acme.test/account/delete" }),
    "account",
  ],
  ["register", form({ actionAbs: "https://acme.test/register" }), "account"],
  [
    "password reset",
    form({ actionAbs: "https://acme.test/lost-password" }),
    "account",
  ],
  [
    "file upload",
    form({ fields: [name, email, fld({ type: "file", name: "cv" })] }),
    "file-upload",
  ],
  [
    "login",
    form({ fields: [name, fld({ type: "password", name: "pw" })] }),
    "login",
  ],
];

for (const [label, f, kind] of NEVER) {
  test(`never submitted: ${label} is classified ${kind} and skipped with a reason`, () => {
    assert.equal(classifyForm(f), kind);
    assert.ok(forbiddenForm(f));
    const [r] = plan([f]);
    assert.equal(r.status, "skipped");
    assert.ok(r.reason.length > 10);
    assert.equal(r.plan, undefined);
  });
}

test("even an explicit --only and --include-newsletter cannot unlock a never-submit kind", () => {
  const [r] = plan(
    [form({ actionAbs: "https://acme.test/wp-comments-post.php" })],
    { only: ["1"], includeNewsletter: true },
  );
  assert.equal(r.status, "skipped");
});

test("a normal contact form is still planned", () => {
  const [r] = plan([form()]);
  assert.equal(r.status, "planned");
});

test("allow-list: needs a reply channel and a name or message field", () => {
  assert.equal(
    leadEligibility({ fields: [name, msg] }),
    "no email or phone field: does not look like a lead form",
  );
  assert.match(
    leadEligibility({ fields: [email, fld({ name: "zip" })] }),
    /no name or message/,
  );
  assert.equal(
    leadEligibility({ fields: [fld({ type: "tel", name: "phone" }), name] }),
    null,
  );
  const [r] = plan([
    form({ fields: [fld({ name: "zip" }), fld({ name: "city" })] }),
  ]);
  assert.equal(r.status, "skipped");
  assert.match(r.reason, /does not look like a lead form/);
});

test("newsletter forms are skipped unless --include-newsletter", () => {
  const nl = form({ fields: [email], id: "news", kind: "newsletter" });
  assert.equal(classifyForm(nl), "newsletter");
  const [a] = plan([nl]);
  assert.equal(a.status, "skipped");
  assert.match(a.reason, /--include-newsletter/);
  const [b] = plan([nl], { includeNewsletter: true });
  assert.equal(b.status, "planned");
});

test("--only selects by number, #id, .class or action text", () => {
  const a = form({
    id: "a",
    className: "x y",
    actionAbs: "https://acme.test/one",
  });
  const b = form({ id: "b", actionAbs: "https://acme.test/two" });
  assert.equal(matchesOnly(a, 1, ["1"]), true);
  assert.equal(matchesOnly(a, 1, ["2"]), false);
  assert.equal(matchesOnly(a, 1, ["#a"]), true);
  assert.equal(matchesOnly(a, 1, [".y"]), true);
  assert.equal(matchesOnly(b, 2, ["/two"]), true);
  const out = plan([a, b], { only: ["#b"] });
  assert.equal(out.find((r) => r.index === 1).status, "skipped");
  assert.match(out.find((r) => r.index === 1).reason, /--only/);
  assert.equal(out.find((r) => r.index === 2).status, "planned");
});

test("robots.txt: a disallowed page is not planned", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /c\n");
  const [r] = plan([form()], { robots });
  assert.equal(r.status, "skipped");
  assert.match(r.reason, /robots\.txt/);
});

test('foreign action is reported as "blocked: foreign host", GET or POST', () => {
  for (const method of ["get", "post"]) {
    const [r] = plan([
      form({ method, actionAbs: "https://elsewhere.test/collect" }),
    ]);
    assert.equal(r.status, "skipped");
    assert.match(r.reason, /^blocked: foreign host/);
  }
});

test("hostKey compares ports; default ports are normalised; www is ignored", () => {
  assert.equal(hostKey("Example.com:443"), "example.com");
  assert.equal(hostKey("example.com:80"), "example.com");
  assert.equal(hostKey("www.example.com"), "example.com");
  assert.equal(hostKey("127.0.0.1:4000"), "127.0.0.1:4000");
  assert.notEqual(hostKey("127.0.0.1:4000"), hostKey("127.0.0.1:4001"));
  const { allowed: a } = checkRails({
    url: "http://127.0.0.1:4000/",
    iOwn: true,
    email: "qa@acme.test",
  });
  assert.equal(assertHostAllowed("127.0.0.1:4000", a), true);
  assert.throws(() => assertHostAllowed("127.0.0.1:4001", a), RailError);
  assert.throws(() => assertHostAllowed("127.0.0.1", a), RailError);
});
