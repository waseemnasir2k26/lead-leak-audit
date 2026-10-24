#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openFile } from "./open.js";
import { askYesNo, formatPlan } from "./confirm.js";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import {
  runScan,
  runSubmit,
  writeReports,
  readBaseline,
  ciVerdict,
} from "./run.js";
import { RailError } from "./submit.js";
import { redactString } from "./redact.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const HELP = `lead-leak-audit ${pkg.version}
Audit your own website's lead path and find where leads die.

Usage
  lead-leak-audit scan <url> [options]
  lead-leak-audit submit <url> --i-own-this-site --email <test-inbox> [options]

Scan (read-only, never submits anything)
  --max-pages <n>        pages to crawl, same origin (default 15)
  --out <dir>            where report.html / report.json go (default ./reports)
  --settle <ms>          wait after load for widgets to render (default 2500)
  --no-link-check        do not request WhatsApp / booking links
  --no-mx-check          do not look up MX records for mailto domains
  --open                 open report.html in your browser when done
  --json                 print a one-line JSON summary to stdout (for n8n / cron)
  --quiet                no progress output

Submit (sends ONE clearly marked test lead per distinct form; only on sites you own)
  --i-own-this-site      required. You own the site or have written permission to test it
  --email <addr>         required. A test inbox you control
  --allow-domain <host>  extra host the forms may post to (repeatable, or comma separated)
  --max-forms <n>        forms per run, hard maximum 10
  --dry-run              show what would be filled; submits nothing
  --only <n|#id|.class|text>  submit only the matching form(s); n is the form number from --dry-run (repeatable)
  --yes                  skip the y/N prompt (unattended). Requires --only, so a run never auto-picks forms
  --max-runtime <min>    whole submit run wall-clock cap (default 10)
  --form-timeout <sec>   per-form cap (default 90)
  --include-newsletter   also submit newsletter forms (this subscribes the test inbox; skipped by default)
  --imap                 measure time-to-first-reply (env: LLA_IMAP_HOST, LLA_IMAP_USER, LLA_IMAP_PASS)
  --wait <minutes>       how long to wait for replies (default 15)

CI
  --ci                   exit with code 2 when the check fails
  --threshold <0-100>    minimum score (default 70 with --ci)
  --baseline <report.json>  also fail if the score dropped more than --max-drop
  --update-baseline      write this report to the --baseline path when it is missing or the run passed
  --max-drop <n>         allowed drop versus the baseline (default 10)

Exit codes: 0 ok, 1 error, 2 CI check failed, 3 refused by a safety rail.
Only run this on sites you own or have written permission to test.
Contact: info@skynetjoe.com
`;

const options = {
  "max-pages": { type: "string" },
  out: { type: "string" },
  settle: { type: "string" },
  "no-link-check": { type: "boolean" },
  "no-mx-check": { type: "boolean" },
  json: { type: "boolean" },
  quiet: { type: "boolean" },
  "i-own-this-site": { type: "boolean" },
  email: { type: "string" },
  "allow-domain": { type: "string", multiple: true },
  "max-forms": { type: "string" },
  "dry-run": { type: "boolean" },
  "include-newsletter": { type: "boolean" },
  yes: { type: "boolean" },
  "max-runtime": { type: "string" },
  "form-timeout": { type: "string" },
  only: { type: "string", multiple: true },
  open: { type: "boolean" },
  imap: { type: "boolean" },
  wait: { type: "string" },
  ci: { type: "boolean" },
  threshold: { type: "string" },
  baseline: { type: "string" },
  "update-baseline": { type: "boolean" },
  "max-drop": { type: "string" },
  headed: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
};

function num(v, name, def, { min = 0, max = Infinity } = {}) {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max)
    throw new Error(`--${name} must be a number between ${min} and ${max}`);
  return n;
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true });
  } catch (e) {
    console.error(`${e.message}\n\n${HELP}`);
    return 1;
  }
  const { values: v, positionals } = parsed;
  if (v.version) {
    console.log(pkg.version);
    return 0;
  }
  const [cmd, url] = positionals;
  if (v.help || !cmd) {
    console.log(HELP);
    return v.help ? 0 : 1;
  }
  if (!["scan", "submit"].includes(cmd) || !url) {
    console.error(
      `Usage: lead-leak-audit ${cmd === "submit" ? "submit" : "scan"} <url>\n`,
    );
    return 1;
  }

  const log =
    v.quiet || v.json ? () => {} : (m) => console.error(`  ${redactString(m)}`);
  const common = {
    maxPages: num(v["max-pages"], "max-pages", 15, { min: 1, max: 200 }),
    settleMs: num(v.settle, "settle", 2500, { min: 0, max: 30000 }),
    linkCheck: !v["no-link-check"],
    mxCheck: !v["no-mx-check"],
    headed: !!v.headed,
    log,
  };
  const outDir = path.resolve(v.out || "reports");

  try {
    let run;
    if (cmd === "scan") {
      run = await runScan(url, common);
    } else {
      const allowDomains = (v["allow-domain"] || [])
        .flatMap((d) => d.split(","))
        .map((d) => d.trim())
        .filter(Boolean);
      run = await runSubmit(url, {
        ...common,
        iOwn: v["i-own-this-site"] === true,
        email: v.email,
        allowDomains,
        dryRun: !!v["dry-run"],
        includeNewsletter: !!v["include-newsletter"],
        yes: !!v.yes,
        maxRuntimeMs: num(v["max-runtime"], "max-runtime", 10, { min: 1, max: 240 }) * 60000,
        formTimeoutMs: num(v["form-timeout"], "form-timeout", 90, { min: 10, max: 900 }) * 1000,
        // Interactive human gate. Without a terminal (and without --yes --only) runSubmit refuses.
        confirm:
          !v.yes && process.stdin.isTTY
            ? async (_summary, text) => {
                console.error(`
${text}`);
                return askYesNo("Send these test leads? [y/N] ");
              }
            : null,
        only: v.only || [],
        maxForms: num(v["max-forms"], "max-forms", 10, { min: 1, max: 10 }),
        imap: !!v.imap,
        waitMinutes: num(v.wait, "wait", 15, { min: 1, max: 240 }),
      });
    }
    const { result, extra } = run;

    if (extra.dryRun) {
      if (v.json)
        console.log(JSON.stringify({ dryRun: true, plan: extra.plan }));
      else {
        console.log("DRY RUN: nothing was submitted.");
        console.log(formatPlan(extra.plan, { email: v.email }));
      }
      return 0;
    }

    const { report, htmlPath, jsonPath } = writeReports(result, outDir, extra);
    if (v.open) openFile(htmlPath);
    const threshold =
      v.ci || v.threshold !== undefined
        ? num(v.threshold, "threshold", 70, { min: 0, max: 100 })
        : null;
    const bl = v.baseline ? readBaseline(path.resolve(v.baseline)) : null;
    const baseline = bl ? bl.score : null;
    const notes = bl?.note ? [bl.note] : [];
    const verdict = ciVerdict({
      score: report.score.value,
      threshold,
      baseline,
      maxDrop: num(v["max-drop"], "max-drop", 10, { min: 0, max: 100 }),
    });

    if (v["update-baseline"]) {
      if (!v.baseline) throw new Error("--update-baseline needs --baseline <report.json> (the file to write).");
      // Seed when missing; otherwise only move the baseline forward on a passing run, so a regression stays visible.
      if (!bl.found || verdict.pass) {
        const dest = path.resolve(v.baseline);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(jsonPath, dest);
        notes.push(`Baseline ${bl.found ? "updated" : "created"}: ${dest}`);
      } else {
        notes.push("Baseline kept (this run failed the check).");
      }
    }

    if (v.json) {
      console.log(
        JSON.stringify({
          score: report.score.value,
          grade: report.score.grade,
          findings: report.findings.length,
          bySeverity: report.score.bySeverity,
          pass: verdict.pass,
          reasons: verdict.reasons,
          baseline,
          notes,
          html: htmlPath,
          json: jsonPath,
        }),
      );
    } else {
      console.log(
        `\nLead survival score: ${report.score.value}/100 (${report.score.grade})`,
      );
      const top = [...report.findings]
        .filter((f) => f.severity !== "info")
        .slice(0, 5);
      for (const f of top) console.log(`  [${f.severity}] ${f.title}`);
      console.log(`\nReport: ${htmlPath}\nJSON:   ${jsonPath}`);
      if (!verdict.pass)
        console.log(`\nCI check failed: ${verdict.reasons.join("; ")}`);
    }
    return v.ci && !verdict.pass ? 2 : 0;
  } catch (e) {
    if (e instanceof RailError) {
      console.error(`\n${e.message}`);
      return 3;
    }
    console.error(`\nError: ${redactString(e.message || String(e))}`);
    if (/Executable doesn't exist|playwright install/i.test(String(e.message)))
      console.error("Run: npx playwright install chromium");
    return 1;
  }
}

function isMainModule() {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
if (isMainModule()) {
  main().then((code) => {
    // exitCode (not process.exit) lets Windows close the Playwright pipes cleanly.
    process.exitCode = code;
    setTimeout(() => process.exit(code), 3000).unref();
  });
}
