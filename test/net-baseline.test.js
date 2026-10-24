import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readBaseline, readBaselineScore, ciVerdict } from "../src/run.js";

test('baseline: missing, unreadable or foreign file means "no baseline yet", never an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lla-bl-"));
  const missing = readBaseline(path.join(dir, "nope", "report.json"));
  assert.equal(missing.found, false);
  assert.equal(missing.score, null);
  assert.match(missing.note, /No baseline yet/);
  fs.writeFileSync(path.join(dir, "junk.json"), "not json");
  assert.equal(readBaseline(path.join(dir, "junk.json")).found, false);
  fs.writeFileSync(
    path.join(dir, "ok.json"),
    JSON.stringify({ score: { value: 88 } }),
  );
  assert.deepEqual(readBaseline(path.join(dir, "ok.json")), {
    found: true,
    score: 88,
    note: null,
  });
  assert.equal(readBaselineScore(path.join(dir, "nope.json")), null);
  assert.equal(
    ciVerdict({ score: 80, threshold: 70, baseline: null }).pass,
    true,
  );
});
