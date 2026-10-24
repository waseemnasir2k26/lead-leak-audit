// Every real-world form shape, end to end: the right forms are submitted exactly once, everything else never.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { runSubmit } from "../src/run.js";
import {
  F,
  GOOD,
  GOOD_SINKS,
  NEWSLETTER,
  startVendorSite,
} from "./vendor-sites.js";

let site;
const OPTS = {
  dwellMs: 0,
  iOwn: true,
  email: "qa@example.test",
  linkCheck: false,
  mxCheck: false,
  settleMs: 150,
  maxPages: 80,
  confirm: async () => true,
};
before(async () => {
  site = await startVendorSite();
});
after(async () => {
  await site?.close();
});

const pageKey = (p) => p.page.replace(/^.*\/p\//, "");

test("dry run: every look-alike shape is rejected with a reason; every real contact form is accepted", async () => {
  const { extra } = await runSubmit(site.url, { ...OPTS, dryRun: true });
  const byKey = new Map();
  for (const p of extra.plan)
    byKey.set(pageKey(p), [...(byKey.get(pageKey(p)) || []), p]);

  for (const key of GOOD) {
    const rows = byKey.get(key);
    assert.ok(rows, `${key} was not found by the crawl`);
    assert.ok(
      rows.some((r) => r.status === "would-submit"),
      `${key} should be accepted: ${JSON.stringify(rows.map((r) => [r.status, r.kind, r.reason]))}`,
    );
  }
  for (const key of NEWSLETTER) {
    const rows = byKey.get(key);
    assert.ok(
      rows.every((r) => r.status === "skipped" && /newsletter/.test(r.reason)),
      key,
    );
  }
  const mustReject = Object.keys(F).filter(
    (k) =>
      !GOOD.includes(k) &&
      !NEWSLETTER.includes(k) &&
      !["typeform", "jotform"].includes(k),
  );
  assert.ok(mustReject.length >= 25);
  for (const key of mustReject) {
    const rows = byKey.get(key);
    assert.ok(rows && rows.length, `${key} form was not seen`);
    for (const r of rows) {
      assert.equal(
        r.status,
        "skipped",
        `${key} must not be submittable: ${JSON.stringify([r.status, r.kind, r.reason])}`,
      );
      assert.ok(r.reason && r.reason.length > 8, `${key} needs a reason`);
    }
  }
  // The fixture's "typeform"/"jotform" iframes are same-origin, so their forms are now scanned: they carry no contact intent, so they are rejected.
  for (const key of ['typeform', 'jotform']) {
    const rows = byKey.get(key);
    assert.ok(rows && rows.length, `${key}: the same-origin frame form should be seen`);
    assert.ok(rows.every((r) => r.status === 'skipped'), `${key} must not be submittable`);
  }
});

test("real run: each real contact form receives exactly one lead, nothing else receives anything", async () => {
  site.hits.length = 0;
  const { extra } = await runSubmit(site.url, OPTS);
  assert.deepEqual(
    [...site.hits].sort(),
    [...GOOD_SINKS].sort(),
    `unexpected POSTs: ${site.hits}`,
  );
  const delivered = extra.submissions.filter((s) => s.status === "delivered");
  assert.equal(
    delivered.length,
    GOOD_SINKS.length,
    JSON.stringify(
      extra.submissions
        .filter((s) => s.status !== "skipped")
        .map((s) => [s.page.split("/p/")[1], s.status, s.detail]),
    ),
  );
});
