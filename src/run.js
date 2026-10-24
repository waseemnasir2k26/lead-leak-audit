// High-level entry points used by the CLI, the demo and the integration tests.
import fs from "node:fs";
import { fetchRobots } from "./net.js";
import { scan, rescore, launchBrowser, normalizeUrl } from "./scan.js";
import { formatPlan } from "./confirm.js";
import {
  RailError,
  checkRails,
  planSubmissions,
  runSubmissions,
  summarizePlan,
} from "./submit.js";
import { submissionFindings, replyFindings } from "./findings.js";
import { waitForReplies, createImapClient } from "./imap.js";
import { imapConfigFromEnv } from "./redact.js";
import { writeReports } from "./report.js";

export async function runScan(url, opts = {}) {
  const result = await scan(url, opts);
  return {
    result,
    extra: { checks: result.checks, submissions: [], replies: [] },
  };
}

/**
 * Scan, then submit one test lead per distinct form. Throws RailError before any browser starts
 * if the safety rails are not satisfied.
 */
export async function runSubmit(url, opts = {}) {
  const {
    iOwn,
    email,
    allowDomains = [],
    dryRun = false,
    maxForms = 10,
    imap = false,
    waitMinutes = 15,
    log = () => {},
    imapClientFactory = createImapClient,
    pollMs,
    rand,
    includeNewsletter = false,
    only = [],
    confirm = null, // async (plan, text) => boolean: the human gate
    yes = false, // unattended: only with an explicit --only selection
    maxRuntimeMs = 10 * 60 * 1000,
    formTimeoutMs = 90 * 1000,
  } = opts;
  const runStart = Date.now();
  const { allowed } = checkRails({ url, iOwn, email, allowDomains }); // throws RailError
  let imapCfg = null;
  if (imap) {
    imapCfg = imapConfigFromEnv();
    if (!imapCfg)
      throw new Error(
        "--imap needs LLA_IMAP_HOST, LLA_IMAP_USER and LLA_IMAP_PASS in the environment.",
      );
  }
  const browser = await launchBrowser(opts);
  try {
    const result = await scan(normalizeUrl(url).href, { ...opts, browser });
    result.meta.mode = dryRun ? "dry-run" : "submit";
    const robots = await fetchRobots(result.meta.origin);
    const planned = planSubmissions(result.inventory, {
      email,
      allowed,
      maxForms,
      rand,
      includeNewsletter,
      only,
      robots,
    });
    if (dryRun) {
      return {
        result,
        extra: {
          checks: result.checks,
          submissions: [],
          replies: [],
          email,
          dryRun: true,
          plan: summarizePlan(planned),
        },
      };
    }
    // Human gate: nothing is sent until a person has seen the plan and said yes.
    if (planned.some((p) => p.status === "planned")) {
      const summary = summarizePlan(planned);
      if (confirm) {
        if (!(await confirm(summary, formatPlan(summary, { email })))) throw new RailError("Cancelled at the confirmation prompt: nothing was sent.");
      } else if (yes) {
        if (!only.length) throw new RailError("--yes needs --only <n|#id|.class|text>: unattended runs must name the forms they may submit.");
      } else {
        throw new RailError("Refusing to send without confirmation. Run interactively and answer y, or pass --yes together with --only to name the forms for an unattended run.");
      }
    }
    const submissions = await runSubmissions(browser, planned, {
      deadline: runStart + maxRuntimeMs,
      formTimeoutMs,
      allowed,
      settleMs: opts.settleMs ? Math.min(opts.settleMs, 2000) : 1500,
      log,
      robots,
      allowSignupForNewsletter: includeNewsletter,
    });
    let replies = [];
    const waiting = submissions.filter(
      (s) =>
        s.leadId &&
        s.submittedAt &&
        ["delivered", "unconfirmed", "error-message"].includes(s.status),
    );
    if (imap && waiting.length) {
      log(
        `waiting up to ${waitMinutes} min for replies to ${waiting.length} test lead(s)`,
      );
      const client = await imapClientFactory(imapCfg);
      try {
        replies = await waitForReplies(
          waiting.map((s) => ({
            leadId: s.leadId,
            label: s.label,
            page: s.page,
            submittedAt: s.submittedAt,
          })),
          { client, waitMinutes, pollMs, log },
        );
      } finally {
        await client.close?.();
      }
    }
    const deadActions = new Set(
      Object.entries(result.checks.actions)
        .filter(([, r]) => [404, 410].includes(r.status) || (r.status === 0 && r.error))
        .map(([u]) => u),
    );
    const extraFindings = [
      ...submissions.flatMap((s) => submissionFindings(s, { deadActions })),
      ...replyFindings(replies),
    ];
    const final = rescore(result, extraFindings);
    return {
      result: final,
      extra: {
        checks: result.checks,
        submissions,
        replies,
        email,
        replyTimingMeasured: imap,
      },
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Read the score from a previous report.json. A missing or unreadable file is "no baseline yet",
 * never an error: the first scheduled run must not fail.
 * @returns {{found:boolean, score:number|null, note:string|null}}
 */
export function readBaseline(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return { found: false, score: null, note: `No baseline yet at ${file}; the drop check is skipped this run.` };
    return { found: false, score: null, note: `Baseline ${file} could not be read (${e.code || e.message}); the drop check is skipped.` };
  }
  try {
    const j = JSON.parse(text);
    if (typeof j?.score?.value === "number") return { found: true, score: j.score.value, note: null };
  } catch {
    /* fall through */
  }
  return { found: false, score: null, note: `Baseline ${file} is not a lead-leak-audit report; the drop check is skipped.` };
}

/** Back-compat helper: the score, or null when there is no usable baseline. */
export function readBaselineScore(file) {
  return readBaseline(file).score;
}

export function ciVerdict({ score, threshold, baseline = null, maxDrop = 10 }) {
  const reasons = [];
  if (threshold !== null && threshold !== undefined && score < threshold)
    reasons.push(`score ${score} is below the threshold ${threshold}`);
  if (baseline !== null && baseline - score > maxDrop)
    reasons.push(
      `score dropped ${baseline - score} points since the baseline (${baseline}), more than ${maxDrop}`,
    );
  return { pass: reasons.length === 0, reasons };
}

export { writeReports };
