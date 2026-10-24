// High-level entry points used by the CLI, the demo and the integration tests.
import fs from "node:fs";
import { scan, rescore, launchBrowser, normalizeUrl } from "./scan.js";
import {
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
  } = opts;
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
    const planned = planSubmissions(result.inventory, {
      email,
      allowed,
      maxForms,
      rand,
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
    const submissions = await runSubmissions(browser, planned, {
      allowed,
      settleMs: opts.settleMs ? Math.min(opts.settleMs, 2000) : 1500,
      log,
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

/** Compare against a previous report.json (n8n / cron use). */
export function readBaselineScore(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  return typeof j?.score?.value === "number" ? j.score.value : null;
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
