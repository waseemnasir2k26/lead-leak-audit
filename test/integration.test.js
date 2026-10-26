// End to end against a local fixture site with real Playwright. No external network.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startDemoServer } from "../examples/demo-site/server.js";
import { runScan, runSubmit, writeReports } from "../src/run.js";
import { RailError } from "../src/submit.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAST = { linkCheck: false, mxCheck: false, settleMs: 500, confirm: async () => true, dwellMs: 0 };
let site;
before(async () => {
  site = await startDemoServer();
});
after(async () => {
  await site?.close();
});
const posts = () => site.requests.filter((r) => r.startsWith("POST"));
const has = (result, id) => result.findings.some((f) => f.id === id);

test("scan: finds every deliberate leak and submits nothing", async () => {
  const before = posts().length;
  const { result } = await runScan(site.url, FAST);
  assert.equal(posts().length, before, "scan must not POST anything");
  assert.equal(site.leads.length, 0);

  const inv = result.inventory;
  assert.equal(inv.forms.filter((f) => f.kind === "contact").length, 3);
  assert.ok(
    inv.forms.some((f) => f.captcha.present && f.captcha.kind === "reCAPTCHA"),
  );
  assert.ok(inv.forms.some((f) => f.honeypots.includes("website_url")));
  assert.equal(inv.whatsapp.length, 2);
  assert.ok(inv.tel.some((t) => t.analysis.e164));
  assert.equal(inv.mailto.length, 1);

  assert.ok(has(result, "form-action-dead"), "broken-action form");
  assert.ok(has(result, "form-js-exception"), "script error next to a form");
  assert.ok(has(result, "wa-bad-number"), "dead wa.me format");
  assert.ok(has(result, "wa-no-prefill"));
  assert.ok(has(result, "chat-not-rendered"), "chat script that never renders");
  assert.ok(has(result, "form-captcha"));
  const tidio = inv.chat.find((c) => c.vendor === "Tidio");
  const crisp = inv.chat.find((c) => c.vendor === "Crisp");
  assert.equal(tidio.rendered, false);
  assert.equal(crisp.rendered, true);
  assert.ok(result.score.score < 70);
  assert.equal(result.meta.mode, "scan");
});

test("scan: robots.txt Disallow is honoured", async () => {
  const { result } = await runScan(site.url, { ...FAST, maxPages: 3 });
  assert.equal(result.meta.pagesCrawled <= 3, true);
  assert.equal(result.meta.robotsRules, 1);
  const full = await runScan(site.url, FAST);
  assert.ok(full.result.meta.skippedByRobots.some((u) => u.includes('/private/')));
  assert.ok(!site.requests.some((r) => r.includes('/private/')), 'a disallowed path was never requested');
});

test("submit: refuses without --i-own-this-site before touching the site", async () => {
  const before = site.requests.length;
  await assert.rejects(
    runSubmit(site.url, { ...FAST, email: "qa@example.test" }),
    RailError,
  );
  await assert.rejects(
    runSubmit(site.url, { ...FAST, iOwn: false, email: "qa@example.test" }),
    /--i-own-this-site/,
  );
  assert.equal(site.requests.length, before, "no request reached the site");
});

test("submit --dry-run: shows the plan and sends nothing", async () => {
  const before = posts().length;
  const { extra } = await runSubmit(site.url, {
    ...FAST,
    iOwn: true,
    email: "qa@example.test",
    dryRun: true,
  });
  assert.equal(posts().length, before);
  assert.equal(site.leads.length, 0);
  assert.ok(extra.plan.some((p) => p.status === "would-submit"));
  assert.ok(extra.plan.some((p) => p.status === "blocked-captcha"));
});

test("submit: one marked lead per form, CAPTCHA form untouched, honeypot empty, outcomes classified", async () => {
  const beforeLeads = site.leads.length;
  const mark = site.requests.length;
  const t = Date.now();
  const { result, extra } = await runSubmit(site.url, {
    ...FAST,
    iOwn: true,
    email: "qa@example.test",
  });
  assert.ok(Date.now() - t < 120000);
  const by = (needle) => extra.submissions.find((s) => s.page.includes(needle));

  const good = by("/contact.html");
  assert.equal(good.status, "accepted");
  assert.match(good.redirect, /thanks\.html$/);
  assert.equal(by("/quote.html").status, "failed");
  assert.equal(by("/quote.html").http, 404);
  assert.equal(by("/captcha.html").status, "blocked-captcha");

  // exactly one lead arrived, and it is clearly a test
  assert.equal(site.leads.length - beforeLeads, 1);
  const lead = site.leads.at(-1);
  assert.equal(lead.name, "LEAD-LEAK-AUDIT TEST");
  assert.equal(lead.email, "qa@example.test");
  assert.match(lead.message, /automated test of my own website/);
  assert.ok(lead.message.includes(good.leadId));
  assert.equal(lead.website_url ?? "", "", "honeypot left empty");

  // one POST per form for this run: /api/lead once (contact), /api/missing once (quote), none for the CAPTCHA form
  const run = site.requests.slice(mark);
  assert.equal(run.filter((r) => r === 'POST /api/lead').length, 1);
  assert.equal(run.filter((r) => r === 'POST /api/missing').length, 1);
  assert.equal(extra.submissions.filter((s) => s.submittedAt).length, 2);

  // findings: the CAPTCHA form is flagged for manual testing; the 404 form is not double counted
  assert.ok(
    result.findings.some(
      (f) => f.id === "submit-blocked-captcha" && /test manually/.test(f.title),
    ),
  );
  assert.ok(
    result.findings.some((f) => f.id === "submit-confirms-dead-action"),
  );
  assert.ok(!result.findings.some((f) => f.id === "submit-http-failed"));
  assert.equal(result.meta.mode, "submit");
});

test("submit: a second run sends exactly one more lead for the good form", async () => {
  const before = site.leads.length;
  await runSubmit(site.url, { ...FAST, iOwn: true, email: "qa@example.test" });
  assert.equal(site.leads.length - before, 1);
});

test("submit: reply timing with an injected inbox fills the speed buckets", async () => {
  process.env.LLA_IMAP_HOST = "imap.example.test";
  process.env.LLA_IMAP_USER = "u";
  process.env.LLA_IMAP_PASS = "integration-pass-123";
  try {
    const client = {
      listMessages: async () => [],
      close: async () => {},
    };
    let seenIds = [];
    client.listMessages = async () => {
      // pretend the site replied 42 seconds after the lead for every ID we are waiting on
      return seenIds.map((id) => ({
        date: new Date(Date.now() + 42_000),
        text: `auto-reply quoting ${id}`,
      }));
    };
    const { result, extra } = await runSubmit(site.url, {
      ...FAST,
      iOwn: true,
      email: "qa@example.test",
      imap: true,
      waitMinutes: 1,
      pollMs: 10,
      imapClientFactory: async () => {
        // capture IDs from what the site received
        seenIds = site.leads
          .map((l) => /LLA-[0-9a-f]{8}/.exec(l.message)?.[0])
          .filter(Boolean);
        return client;
      },
    });
    assert.equal(extra.replies.length, 1);
    assert.equal(extra.replies[0].bucket, "great");
    assert.equal(
      extra.submissions.find((s) => s.leadId === extra.replies[0].leadId)?.status,
      "delivered",
      "an IMAP reply is the only thing that upgrades a lead to delivered",
    );
    assert.ok(extra.replyTimingMeasured);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lla-int-"));
    const { jsonPath, htmlPath } = writeReports(result, dir, extra);
    for (const p of [jsonPath, htmlPath])
      assert.ok(!fs.readFileSync(p, "utf8").includes("integration-pass-123"));
  } finally {
    for (const k of ["LLA_IMAP_HOST", "LLA_IMAP_USER", "LLA_IMAP_PASS"])
      delete process.env[k];
  }
});

// Async on purpose: the fixture server lives in this process, so a blocking spawnSync would starve it.
function cli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'src', 'cli.js'), ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 120000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

test("cli: submit without the ownership flag exits 3 and sends nothing", async () => {
  const before = site.requests.length;
  const r = await cli(["submit", site.url, "--email", "qa@example.test"]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /--i-own-this-site/);
  assert.equal(site.requests.length, before);
});

test("cli: --ci exits 2 when the score is below the threshold; writes report files", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "lla-cli-"));
  const r = await cli([
    "scan",
    site.url,
    "--ci",
    "--threshold",
    "90",
    "--no-link-check",
    "--no-mx-check",
    "--settle",
    "300",
    "--out",
    out,
    "--json",
  ]);
  assert.equal(r.status, 2, r.stderr);
  const summary = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(summary.pass, false);
  assert.ok(summary.score < 90);
  assert.ok(fs.existsSync(path.join(out, "report.html")));
  assert.ok(fs.existsSync(path.join(out, "report.json")));

  const ok = await cli([
    "scan",
    site.url,
    "--ci",
    "--threshold",
    "0",
    "--no-link-check",
    "--no-mx-check",
    "--settle",
    "300",
    "--out",
    out,
    "--json",
  ]);
  assert.equal(ok.status, 0, ok.stderr);

  // baseline drop: previous report scored higher than a fake baseline of 100 by more than 10
  fs.writeFileSync(
    path.join(out, "base.json"),
    JSON.stringify({ score: { value: 100 } }),
  );
  const drop = await cli([
    "scan",
    site.url,
    "--ci",
    "--threshold",
    "0",
    "--baseline",
    path.join(out, "base.json"),
    "--no-link-check",
    "--no-mx-check",
    "--settle",
    "300",
    "--out",
    out,
    "--json",
  ]);
  assert.equal(drop.status, 2);
});

test('cli: first scheduled run with a missing baseline prints a summary, does not fail, and seeds the baseline', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lla-first-'));
  const baseline = path.join(out, 'baseline', 'report.json');
  const args = ['scan', site.url, '--ci', '--threshold', '0', '--baseline', baseline, '--update-baseline', '--no-link-check', '--no-mx-check', '--settle', '300', '--out', path.join(out, 'latest'), '--quiet', '--json'];
  const first = await cli(args);
  assert.equal(first.status, 0, first.stderr);
  const s1 = JSON.parse(first.stdout.trim().split('\n').pop());
  assert.equal(s1.pass, true);
  assert.equal(s1.baseline, null);
  assert.ok(s1.notes.some((n) => /No baseline yet/.test(n)));
  assert.ok(s1.notes.some((n) => /Baseline created/.test(n)));
  assert.ok(fs.existsSync(baseline));

  // second run compares against the seeded baseline; a much higher fake baseline makes it fail and is kept
  fs.writeFileSync(baseline, JSON.stringify({ score: { value: 100 } }));
  const second = await cli(args);
  assert.equal(second.status, 2);
  const s2 = JSON.parse(second.stdout.trim().split('\n').pop());
  assert.equal(s2.baseline, 100);
  assert.ok(s2.notes.some((n) => /Baseline kept/.test(n)));
  assert.equal(JSON.parse(fs.readFileSync(baseline, 'utf8')).score.value, 100);
});
