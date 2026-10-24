import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPrivateIp, isPrivateTarget, checkLink } from '../src/net.js';
import { readBaseline, readBaselineScore, ciVerdict } from '../src/run.js';

test('private, loopback and link-local addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('isPrivateTarget: literals, localhost names, DNS answers', async () => {
  assert.equal(await isPrivateTarget('http://169.254.169.254/latest/meta-data'), true);
  assert.equal(await isPrivateTarget('http://localhost:3000/'), true);
  assert.equal(await isPrivateTarget('http://printer.local/'), true);
  assert.equal(await isPrivateTarget('http://[::1]/'), true);
  assert.equal(await isPrivateTarget('https://calendly.com/x', async () => [{ address: '104.18.1.1' }]), false);
  assert.equal(await isPrivateTarget('https://rebind.example/x', async () => [{ address: '10.0.0.5' }]), true);
});

test('checkLink never requests a private target, including via redirect', async () => {
  const seen = [];
  const fetchImpl = async (u) => {
    seen.push(u);
    return { status: 200, headers: new Headers(), body: null };
  };
  const direct = await checkLink('http://169.254.169.254/latest', { fetchImpl });
  assert.equal(direct.skipped, true);
  assert.equal(direct.inconclusive, true);
  assert.deepEqual(seen, []);

  const redirecting = async (u) => {
    seen.push(u);
    if (u.startsWith('https://public.example/')) return { status: 302, headers: new Headers({ location: 'http://169.254.169.254/x' }), body: null };
    return { status: 200, headers: new Headers(), body: null };
  };
  const r = await checkLink('https://public.example/go', { fetchImpl: redirecting, lookup: async () => [{ address: '93.184.216.34' }] });
  assert.equal(r.skipped, true);
  assert.deepEqual(seen, ['https://public.example/go'], 'the private hop was never fetched');
});

test('checkLink allows the scanned site itself even on a private host', async () => {
  const fetchImpl = async () => ({ status: 200, headers: new Headers(), body: null });
  const r = await checkLink('http://127.0.0.1:4173/page', { fetchImpl, allowHost: '127.0.0.1:4173' });
  assert.equal(r.ok, true);
});

test('baseline: missing, unreadable or foreign file means "no baseline yet", never an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lla-bl-'));
  const missing = readBaseline(path.join(dir, 'nope', 'report.json'));
  assert.equal(missing.found, false);
  assert.equal(missing.score, null);
  assert.match(missing.note, /No baseline yet/);
  fs.writeFileSync(path.join(dir, 'junk.json'), 'not json');
  assert.equal(readBaseline(path.join(dir, 'junk.json')).found, false);
  fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify({ score: { value: 88 } }));
  assert.deepEqual(readBaseline(path.join(dir, 'ok.json')), { found: true, score: 88, note: null });
  assert.equal(readBaselineScore(path.join(dir, 'nope.json')), null);
  assert.equal(ciVerdict({ score: 80, threshold: 70, baseline: null }).pass, true);
});
