// End to end: never-submit forms stay untouched, and the in-browser foreign-host guard holds.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startDemoServer } from "../examples/demo-site/server.js";
import { runSubmit } from "../src/run.js";
import { buildReport } from "../src/report.js";

const FAST = {
  confirm: async () => true,
  dwellMs: 0,
  linkCheck: false,
  mxCheck: false,
  settleMs: 400,
  iOwn: true,
  email: "qa@example.test",
};
let site;
let foreign;
let foreignSite;
const foreignRequests = [];

before(async () => {
  site = await startDemoServer();
  // A second server on another port: nothing may ever reach it.
  foreign = http.createServer((req, res) => {
    foreignRequests.push(`${req.method} ${req.url}`);
    res.writeHead(200);
    res.end("should never be called");
  });
  await new Promise((r) => foreign.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${foreign.address().port}`;
  foreignSite = await startDemoServer({ foreign: origin });
});
after(async () => {
  await site?.close();
  await foreignSite?.close();
  await new Promise((r) => foreign?.close(r));
});

test("dry run: comment, cart, unsubscribe, delete, upload and newsletter forms are would-skip with a reason", async () => {
  const { extra } = await runSubmit(site.url, { ...FAST, dryRun: true });
  const risky = extra.plan.filter((p) => p.page.endsWith("/risky.html"));
  assert.equal(risky.length, 6);
  assert.ok(
    risky.every((p) => p.status === "skipped" && p.reason.length > 10),
    JSON.stringify(risky.map((p) => [p.kind, p.status, p.reason])),
  );
  const kinds = risky.map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['account', 'account', 'comment', 'commerce', 'file-upload', 'newsletter']);
  assert.ok(risky.some((p) => /comment/.test(p.reason)));
  assert.ok(risky.some((p) => /cart/.test(p.reason)));
  assert.ok(risky.some((p) => /--include-newsletter/.test(p.reason)));
  assert.ok(extra.plan.some((p) => p.status === "would-submit"));
});

test("real run: zero requests reach the comment, cart, unsubscribe, delete, upload and newsletter endpoints", async () => {
  const { extra } = await runSubmit(site.url, FAST);
  assert.deepEqual(
    site.hits,
    [],
    `state-changing endpoints were hit: ${site.hits}`,
  );
  assert.ok(
    !site.requests.some((r) =>
      /^POST \/(wp-comments-post|cart|unsubscribe|subscribe|account|api\/upload)/.test(
        r,
      ),
    ),
  );
  assert.ok(
    extra.submissions.some((s) => s.status === "delivered"),
    "the real contact form was still tested",
  );
});

test("--include-newsletter submits the newsletter form and nothing else from the risky page", async () => {
  site.hits.length = 0;
  await runSubmit(site.url, { ...FAST, includeNewsletter: true });
  assert.deepEqual(site.hits, ["/subscribe"]);
});

test("--only limits the run to the chosen form", async () => {
  const before = site.leads.length;
  const { extra } = await runSubmit(site.url, {
    ...FAST,
    only: ["#nonexistent"],
  });
  assert.equal(site.leads.length, before);
  assert.ok(extra.submissions.every((s) => s.status !== "delivered"));
});

test("foreign host guard: JS-changed action, cross-origin GET form and JS-changed GET form never reach the other server", async () => {
  const startUrl = `${foreignSite.url}foreign.html`;
  const { result, extra } = await runSubmit(startUrl, { ...FAST, maxPages: 1 });
  assert.deepEqual(
    foreignRequests,
    [],
    `foreign server was contacted: ${foreignRequests}`,
  );

  const subs = extra.submissions.filter((s) =>
    s.page.endsWith("/foreign.html"),
  );
  assert.equal(subs.length, 3);
  for (const s of subs) {
    assert.equal(s.status, "skipped", JSON.stringify(s));
    assert.match(s.detail || s.reason, /blocked: foreign host/);
  }
  // the two that could only be caught inside the browser were actually attempted
  assert.equal(subs.filter((s) => s.submittedAt).length, 2);

  const report = buildReport(result, extra);
  assert.equal(
    report.submissions.filter((s) =>
      /blocked: foreign host/.test(s.detail || ""),
    ).length,
    3,
  );
  assert.deepEqual(foreignRequests, []);
});

test('endpoint gate: formaction, form= association, script-set formaction and fetch() never reach forbidden paths', async () => {
  site.hits.length = 0;
  const leadsBefore = site.leads.length;
  const mark = site.requests.length;
  const { extra } = await runSubmit(`${site.url}endpoints.html`, { ...FAST, maxPages: 1 });
  const run = site.requests.slice(mark);
  const forbidden = run.filter((r) => /(wp-comments-post|\/cart|unsubscribe|private\/collect|\/account|\/subscribe)/.test(r));
  assert.deepEqual(forbidden, [], `forbidden paths were requested: ${forbidden}`);
  assert.deepEqual(site.hits, []);
  assert.equal(site.leads.length, leadsBefore, 'no lead was posted by any of these forms');

  const subs = extra.submissions.filter((s) => s.page.endsWith('/endpoints.html'));
  assert.equal(subs.length, 8);
  assert.ok(subs.every((s) => s.status === 'skipped'), JSON.stringify(subs.map((s) => [s.status, s.reason || s.detail])));
  // 6 are refused at plan time (formaction x4, login via form=, comment via form=); 2 only show at the network layer
  const attempted = subs.filter((s) => s.submittedAt);
  assert.equal(attempted.length, 2, 'script-set formaction and fetch() forms were actually clicked');
  for (const s of attempted) assert.match(s.detail, /^blocked: forbidden endpoint/);
  for (const s of subs.filter((x) => !x.submittedAt)) assert.match(s.reason, /blocked: forbidden endpoint|login|comment/);
});
