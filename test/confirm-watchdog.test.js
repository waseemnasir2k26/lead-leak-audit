// Human confirmation gate and the run/form watchdogs.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startDemoServer } from "../examples/demo-site/server.js";
import { runSubmit } from "../src/run.js";
import { RailError } from "../src/submit.js";
import { formatPlan } from "../src/confirm.js";
import { assessForm } from "../src/classify.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = {
  iOwn: true,
  email: "qa@example.test",
  linkCheck: false,
  mxCheck: false,
  settleMs: 300,
  maxPages: 2,
};
let site;
let slow;
let slowUrl;
before(async () => {
  site = await startDemoServer();
  slow = http.createServer((q, r) => {
    const u = new URL(q.url, "http://x");
    if (q.method === "POST") return; // never answers: a handler that hangs
    r.writeHead(200, { "content-type": "text/html" });
    if (u.pathname === "/robots.txt") return r.end("");
    const form = (n) =>
      `<form action="/hang/${n}" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button type="submit">Send</button></form>`;
    r.end(`<title>Slow</title><h1>Contact</h1>${form(1)}`);
  });
  await new Promise((r) => slow.listen(0, "127.0.0.1", r));
  slowUrl = `http://127.0.0.1:${slow.address().port}/`;
});
after(async () => {
  await site?.close();
  slow?.closeAllConnections?.();
  await new Promise((r) => slow?.close(r));
});

const posts = () => site.requests.filter((r) => r.startsWith("POST"));

test("no confirm callback and no --yes: refuses before sending anything", async () => {
  const before = posts().length;
  await assert.rejects(
    runSubmit(site.url, BASE),
    (e) => e instanceof RailError && /without confirmation/.test(e.message),
  );
  assert.equal(posts().length, before);
});

test('a "no" at the prompt sends nothing', async () => {
  const before = posts().length;
  let shown;
  await assert.rejects(
    runSubmit(site.url, {
      ...BASE,
      confirm: async (summary, text) => {
        shown = { summary, text };
        return false;
      },
    }),
    (e) => e instanceof RailError && /Cancelled/.test(e.message),
  );
  assert.equal(posts().length, before);
  assert.ok(shown.summary.some((p) => p.status === "would-submit"));
  assert.match(shown.text, /WILL SUBMIT/);
  assert.match(shown.text, /page:\s+http/);
  assert.match(shown.text, /button:\s+Send/);
});

test("--yes without --only is refused; --yes with --only submits only the named form", async () => {
  const before = posts().length;
  await assert.rejects(
    runSubmit(site.url, { ...BASE, yes: true }),
    (e) => e instanceof RailError && /--yes needs --only/.test(e.message),
  );
  assert.equal(posts().length, before);
  const leads = site.leads.length;
  const { extra } = await runSubmit(site.url, {
    ...BASE,
    yes: true,
    only: ["#contact"],
  });
  assert.equal(extra.submissions.filter((s) => s.submittedAt).length, 1);
  assert.equal(site.leads.length - leads, 1);
});

test("the printed plan shows page, heading, button, fields, verdict and reason per form", () => {
  const text = formatPlan(
    [
      {
        index: 1,
        status: "would-submit",
        page: "https://a.test/contact",
        heading: "Contact us",
        submitText: "Send message",
        kind: "contact",
        fields: [{ field: "email", value: "q***@a.test" }],
        skippedFields: [],
      },
      {
        index: 2,
        status: "skipped",
        page: "https://a.test/reviews",
        heading: "Leave a review",
        submitText: "Post review",
        kind: "comment",
        reason: 'negative signal "review" in headings',
        fields: [],
        skippedFields: [],
      },
    ],
    { email: "qa@a.test" },
  );
  assert.match(text, /1 form\(s\) would be submitted, 1 will not be/);
  assert.match(text, /#1 WILL SUBMIT/);
  assert.match(text, /#2 will NOT submit \(skipped\)/);
  assert.match(text, /heading: Leave a review/);
  assert.match(text, /reason:\s+negative signal "review"/);
  assert.match(text, /q\*\*\*@a\.test/);
});

function cli(args) {
  return new Promise((resolve) => {
    const c = spawn(
      process.execPath,
      [path.join(ROOT, "src", "cli.js"), ...args],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (status) => resolve({ status, stderr }));
  });
}

test("cli: no terminal and no --yes --only means exit 3 and nothing sent", async () => {
  const before = posts().length;
  const r = await cli([
    "submit",
    site.url,
    "--i-own-this-site",
    "--email",
    "qa@example.test",
    "--no-link-check",
    "--no-mx-check",
    "--settle",
    "300",
    "--max-pages",
    "2",
    "--out",
    path.join(ROOT, "reports", "cli-confirm-test"),
  ]);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /without confirmation/);
  assert.equal(posts().length, before);
});

test("allow-list: amount, price and quantity fields mean the form is never submitted", () => {
  const f = (extra) => ({
    firstPage: "https://a.test/contact",
    pageTitle: "Contact",
    fields: [
      { tag: "input", type: "text", name: "name", visible: true },
      { tag: "input", type: "email", name: "email", visible: true },
      { tag: "textarea", type: "textarea", name: "message", visible: true },
      extra,
    ],
    submitTexts: ["Send"],
  });
  assert.equal(
    assessForm(f({ tag: "input", type: "text", name: "x", visible: true }))
      .verdict,
    "lead",
  );
  for (const name of ["amount", "custom_amount", "price", "quantity", "qty"]) {
    const a = assessForm(
      f({ tag: "input", type: "text", name, visible: true }),
    );
    assert.equal(a.verdict, "reject", name);
  }
});

test("per-form watchdog: a handler that never answers is stopped and reported as a timeout", async () => {
  const t = Date.now();
  const { extra, result } = await runSubmit(slowUrl, {
    ...BASE,
    maxPages: 1,
    confirm: async () => true,
    formTimeoutMs: 6000,
  });
  assert.ok(Date.now() - t < 40000);
  const s = extra.submissions.find((x) => x.page.startsWith(slowUrl));
  assert.equal(s.status, "timeout", JSON.stringify(s));
  assert.ok(s.timedOut);
  assert.ok(result.findings.some((f) => f.id === "submit-timeout"));
});

test("whole-run watchdog: forms after the wall-clock cap are not submitted and say so", async () => {
  const { extra } = await runSubmit(site.url, {
    ...BASE,
    confirm: async () => true,
    maxRuntimeMs: 1,
  });
  const capped = extra.submissions.filter((s) => s.timedOut);
  assert.ok(capped.length >= 1);
  assert.ok(
    capped.every(
      (s) =>
        s.status === "skipped" &&
        /run time cap/.test(s.reason) &&
        !s.submittedAt,
    ),
  );
});
