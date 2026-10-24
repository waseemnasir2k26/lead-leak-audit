// Bypass attempts: nothing may ever reach the foreign server, whatever the page or the server does.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { runSubmit } from "../src/run.js";
import { ATTACKS, startAttackSites } from "./vendor-sites.js";

let sites;
const OPTS = {
  iOwn: true,
  email: "qa@example.test",
  linkCheck: false,
  mxCheck: false,
  settleMs: 150,
  maxPages: 30,
  confirm: async () => true,
};
before(async () => {
  sites = await startAttackSites();
});
after(async () => {
  await sites?.close();
});

const KEYS = Object.keys(ATTACKS);
const SINK = (i) =>
  `/sink/${["a1", "a2", "a3", "a4", "a5", "metaref", "redir307", "chain1", "a8", "a9", "a10", "a11", "a12"][i]}`;

async function runKeys(keys) {
  const only = keys.map((k) => SINK(KEYS.indexOf(k)));
  const { extra } = await runSubmit(sites.url, { ...OPTS, only });
  const byKey = {};
  for (const s of extra.submissions) {
    const k = KEYS.find(
      (key) => s.action && s.action.endsWith(SINK(KEYS.indexOf(key))),
    );
    if (k) byKey[k] = s;
  }
  return byKey;
}

test("fetch, beacon, XHR, window.open, programmatic form, location change, image GET, WebSocket: the foreign host sees nothing", async () => {
  const keys = [
    "fetchForeign",
    "beacon",
    "xhr",
    "windowOpen",
    "formSubmitProg",
    "actionJs",
    "imgGet",
    "wsock",
  ];
  const res = await runKeys(keys);
  assert.deepEqual(
    sites.foreignHits,
    [],
    `the foreign server was contacted: ${sites.foreignHits}`,
  );
  for (const k of keys) assert.ok(res[k], `${k} was not tested`);
  // the legitimate submission still happened for each
  for (const k of keys)
    assert.ok(
      sites.hits.includes(`main ${SINK(KEYS.indexOf(k))}`),
      `${k}: lead missing`,
    );
  // GET beacons and websockets are recorded, not sent
  assert.ok(
    res.imgGet.blockedRequests.some((b) => /img/.test(b)),
    JSON.stringify(res.imgGet.blockedRequests),
  );
  assert.ok(
    res.wsock.blockedRequests.some((b) => /websocket/.test(b)),
    JSON.stringify(res.wsock.blockedRequests),
  );
});

test('redirects: a 307 to a foreign host and a chain that ends there are aborted, reported, and never "delivered"', async () => {
  const before = sites.foreignHits.length;
  const res = await runKeys(["redirect307", "redirectChain", "metaRefresh"]);
  assert.equal(
    sites.foreignHits.length,
    before,
    `the foreign server was contacted: ${sites.foreignHits}`,
  );
  for (const k of ["redirect307", "redirectChain"]) {
    assert.equal(res[k].status, "skipped", `${k}: ${JSON.stringify(res[k])}`);
    assert.match(
      res[k].detail,
      /^blocked: redirect to foreign host 127\.0\.0\.1:\d+/,
    );
  }
  assert.notEqual(res.metaRefresh.status, "failed");
});

test("service worker: blocked, so it cannot forward a request to another host", async () => {
  const before = sites.foreignHits.length;
  await runKeys(["sw"]);
  assert.equal(
    sites.foreignHits.length,
    before,
    `service worker reached the foreign host: ${sites.foreignHits}`,
  );
});

test('target=_blank: the popup result is seen, so it is not reported as "sent nothing"', async () => {
  const res = await runKeys(["targetBlank"]);
  assert.equal(
    res.targetBlank.status,
    "delivered",
    JSON.stringify(res.targetBlank),
  );
  assert.ok(res.targetBlank.popups >= 1);
  assert.deepEqual(sites.foreignHits, []);
});
