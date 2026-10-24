// report.json + a single self-contained report.html (light theme, printable, readable on a phone).
import fs from "node:fs";
import path from "node:path";
import {
  redactDeep,
  assertNoSecrets,
  maskEmail,
  collectSecrets,
} from "./redact.js";
import { SEVERITIES, CATEGORIES, PENALTY, CATEGORY_CAP } from "./score.js";
import { formatDuration } from "./findings.js";

export const FOOTER_TEXT =
  "Report by lead-leak-audit (open source) · Want these leaks fixed? https://skynetjoe.com";

export function esc(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

/** Shape the JSON report. Everything is passed through redaction. */
export function buildReport(result, extra = {}) {
  const { meta, inventory, findings, score } = result;
  const slimForms = inventory.forms.map((f) => ({
    kind: f.kind,
    pages: f.pages,
    action: f.actionAbs,
    method: f.method,
    requiredFields: f.required,
    fields: f.fields.map((x) => ({
      name: x.name || x.id,
      type: x.type,
      required: x.required,
      visible: x.visible,
      honeypot: x.honeypot,
    })),
    honeypots: f.honeypots,
    captcha: f.captcha,
    submitButton: f.submit
      ? { text: f.submit.text, w: f.submit.w, h: f.submit.h }
      : null,
    visibleOnMobile: f.visibleOnMobile,
  }));
  const report = {
    tool: "lead-leak-audit",
    version: meta.version,
    generatedAt: new Date().toISOString(),
    mode: meta.mode,
    target: meta.url,
    score: {
      value: score.score,
      grade: score.grade.label,
      penalty: score.penalty,
      bySeverity: score.bySeverity,
      byCategory: score.byCategory,
    },
    scan: {
      pagesCrawled: meta.pagesCrawled,
      maxPages: meta.maxPages,
      durationMs: meta.durationMs,
      skippedByRobots: meta.skippedByRobots,
      linkCheck: meta.linkCheck,
      mxCheck: meta.mxCheck,
    },
    inventory: {
      pages: inventory.pages.map((p) => ({
        url: p.url,
        status: p.status,
        title: p.title,
        forms: p.forms,
        error: p.error,
      })),
      forms: slimForms,
      mailto: inventory.mailto.map((m) => ({
        href: m.href,
        valid: m.analysis.valid,
        issue: m.analysis.issue,
        pages: m.pages,
      })),
      tel: inventory.tel.map((t) => ({
        href: t.href,
        valid: t.analysis.valid,
        e164: t.analysis.e164,
        issue: t.analysis.issue,
        pages: t.pages,
      })),
      whatsapp: inventory.whatsapp.map((w) => ({
        href: w.href,
        valid: w.analysis.valid,
        issue: w.analysis.issue,
        prefilled: w.analysis.prefilled,
        resolves: extra.checks?.links?.[w.href]?.ok ?? null,
        pages: w.pages,
      })),
      chat: inventory.chat.map((c) => ({
        vendor: c.vendor,
        rendered: c.rendered,
        pages: c.pages,
      })),
      booking: inventory.booking.map((b) => ({
        vendor: b.vendor,
        href: b.href,
        resolves: extra.checks?.links?.[b.href]?.ok ?? null,
        pages: b.pages,
      })),
    },
    submissions: (extra.submissions || []).map((s) => ({
      form: s.label,
      page: s.page,
      status: s.status,
      detail: s.detail || s.reason || null,
      httpStatus: s.http ?? null,
      redirect: s.redirect || null,
      confirmation: s.confirmation || null,
      evidence: s.evidence || null,
      leadId: s.leadId || null,
      submittedAt: s.submittedAt || null,
      networkErrors: s.networkErrors || [],
    })),
    replies: (extra.replies || []).map((r) => ({
      form: r.label,
      leadId: r.leadId,
      seconds: r.seconds,
      bucket: r.bucket,
      waitedMinutes: r.waitedMinutes,
    })),
    testInbox: extra.email ? maskEmail(extra.email) : null,
    replyTimingMeasured: !!extra.replyTimingMeasured,
    findings: findings.map(
      ({ n, id, severity, category, title, detail, fix, where, evidence }) => ({
        n,
        id,
        severity,
        category,
        title,
        detail,
        fix,
        where,
        evidence,
      }),
    ),
  };
  return redactDeep(report);
}

const TONE = {
  Healthy: "#15803d",
  Leaky: "#b45309",
  Bleeding: "#c2410c",
  Critical: "#b91c1c",
};
const SEV_COLOR = {
  critical: "#b91c1c",
  high: "#c2410c",
  medium: "#b45309",
  low: "#4b5563",
  info: "#1d4ed8",
};

export function renderHtml(report) {
  const sc = report.score;
  const color = TONE[sc.grade] || "#374151";
  const sorted = [...report.findings].sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      a.n - b.n,
  );
  const inv = report.inventory;
  const cat = Object.entries(sc.byCategory).sort(
    (a, b) => b[1].penalty - a[1].penalty,
  );

  const sevPills = SEVERITIES.map(
    (s) =>
      `<span class="pill" style="--c:${SEV_COLOR[s]}">${esc(s)} ${sc.bySeverity[s] || 0}</span>`,
  ).join("");
  const catRows = cat.length
    ? cat
        .map(
          ([k, v]) =>
            `<tr><td>${esc(v.label || CATEGORIES[k] || k)}</td><td class="bar"><span style="width:${v.score}%;background:${v.score >= 90 ? "#15803d" : v.score >= 70 ? "#b45309" : "#b91c1c"}"></span></td><td class="num">${v.score}</td><td class="num dim">-${v.lost ?? v.penalty}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4" class="dim">No leaks found.</td></tr>';

  const findingCards = sorted.length
    ? sorted
        .map(
          (f) => `<article class="leak" style="--c:${SEV_COLOR[f.severity]}">
  <header><span class="sev">${esc(f.severity)}</span><h3>${esc(f.title)}</h3></header>
  <p>${esc(f.detail)}</p>
  <p class="fix"><strong>Fix:</strong> ${esc(f.fix)}</p>
  ${
    f.where?.length
      ? `<p class="where">Found on: ${f.where
          .slice(0, 3)
          .map((w) => `<code>${esc(w)}</code>`)
          .join(
            " ",
          )}${f.where.length > 3 ? ` and ${f.where.length - 3} more` : ""}</p>`
      : ""
  }
  ${f.evidence ? `<p class="where">Evidence: <code>${esc(f.evidence)}</code></p>` : ""}
</article>`,
        )
        .join("\n")
    : '<p class="ok">No leaks found on the pages scanned.</p>';

  const formRows = inv.forms
    .map(
      (f) =>
        `<tr><td>${esc(f.kind)}</td><td><code>${esc(f.method.toUpperCase())} ${esc(f.action)}</code></td><td>${f.requiredFields} required</td><td>${f.captcha.present ? esc(f.captcha.kind) : "none"}</td><td>${f.honeypots.length ? "yes (" + f.honeypots.length + ")" : "no"}</td></tr>`,
    )
    .join("");
  const linkRows = [
    ...inv.mailto.map((m) => ["email", m.href, m.valid ? "ok" : m.issue]),
    ...inv.tel.map((t) => [
      "phone",
      t.href,
      t.valid ? (t.e164 ? "ok (E.164)" : t.issue || "ok") : t.issue,
    ]),
    ...inv.whatsapp.map((w) => [
      "WhatsApp",
      w.href,
      [
        w.valid ? "format ok" : w.issue,
        w.prefilled ? "prefilled" : "no prefill",
        w.resolves === null
          ? "not checked"
          : w.resolves
            ? "resolves"
            : "does not resolve",
      ].join(", "),
    ]),
    ...inv.booking.map((b) => [
      b.vendor,
      b.href,
      b.resolves === null
        ? "not checked"
        : b.resolves
          ? "resolves"
          : "does not resolve",
    ]),
    ...inv.chat.map((c) => [
      "chat",
      c.vendor,
      c.rendered ? "rendered" : "not rendered",
    ]),
  ]
    .map(
      (r) =>
        `<tr><td>${esc(r[0])}</td><td class="break"><code>${esc(r[1])}</code></td><td>${esc(r[2])}</td></tr>`,
    )
    .join("");

  const subRows = report.submissions
    .map(
      (s) =>
        `<tr><td>${esc(s.form)}</td><td><span class="st st-${esc(s.status)}">${esc(s.status)}</span></td><td>${esc(s.detail || "")}</td></tr>`,
    )
    .join("");
  const replyRows = report.replies
    .map(
      (r) =>
        `<tr><td>${esc(r.form)}</td><td>${r.seconds === null ? "no reply" : esc(formatDuration(r.seconds))}</td><td><span class="st st-${esc(r.bucket)}">${esc(r.bucket)}</span></td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lead leak report - ${esc(report.target)}</title>
<style>
:root{--ink:#111827;--dim:#6b7280;--line:#e5e7eb;--bg:#f9fafb;--card:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:920px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 10px}h3{font-size:15px;margin:0}
.dim{color:var(--dim)}code{font:12.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#f3f4f6;padding:1px 5px;border-radius:4px;word-break:break-all}
.hero{display:flex;gap:24px;align-items:center;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}
.ring{width:132px;height:132px;border-radius:50%;background:conic-gradient(${color} ${sc.value * 3.6}deg,#e5e7eb 0);display:grid;place-items:center;flex:none}
.ring div{width:104px;height:104px;border-radius:50%;background:#fff;display:grid;place-items:center;text-align:center}
.ring b{font-size:34px;line-height:1;display:block;color:${color}}.ring span{font-size:12px;color:var(--dim)}
.pills{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.pill{border:1px solid var(--c);color:var(--c);border-radius:99px;padding:1px 10px;font-size:12px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden;font-size:13.5px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{background:#f3f4f6;font-weight:600}
td.num{text-align:right;width:48px}td.bar{width:38%}td.bar span{display:block;height:8px;border-radius:4px}.break{word-break:break-all}
.leak{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--c);border-radius:8px;padding:12px 14px;margin:10px 0;break-inside:avoid}
.leak header{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.sev{font-size:11px;text-transform:uppercase;letter-spacing:.04em;font-weight:700;color:var(--c)}
.leak p{margin:6px 0 0}.fix{background:#f0fdf4;border-radius:6px;padding:6px 10px}.where{font-size:12.5px;color:var(--dim)}
.ok{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px}
.st{font-size:12px;border-radius:4px;padding:1px 7px;background:#f3f4f6}
.st-delivered,.st-great,.st-ok{background:#dcfce7;color:#166534}.st-failed,.st-no-request,.st-dead,.st-leak{background:#fee2e2;color:#991b1b}
.st-unconfirmed,.st-error-message,.st-client-validation{background:#fef3c7;color:#92400e}.st-blocked-captcha,.st-skipped,.st-would-submit{background:#dbeafe;color:#1e40af}
.scroll{overflow-x:auto}
footer{margin-top:36px;padding-top:14px;border-top:1px solid var(--line);color:var(--dim);font-size:13px}
footer a{color:#1d4ed8}
@media print{body{background:#fff}main{padding:0}.leak,.hero,table{break-inside:avoid}a{color:inherit}}
@media (max-width:520px){.ring{margin:0 auto}}
</style>
</head>
<body>
<main>
<h1>Lead leak report</h1>
<p class="dim"><code>${esc(report.target)}</code> · ${esc(report.mode)} mode · ${esc(report.generatedAt.slice(0, 16).replace("T", " "))} UTC · ${report.scan.pagesCrawled} page(s) scanned</p>

<section class="hero">
  <div class="ring"><div><b>${sc.value}</b><span>of 100</span></div></div>
  <div style="flex:1;min-width:220px">
    <h2 style="margin:0">Lead survival score: ${esc(sc.grade)}</h2>
    <p class="dim" style="margin:4px 0 0">100 minus penalties per leak (critical -${PENALTY.critical}, high -${PENALTY.high}, medium -${PENALTY.medium}, low -${PENALTY.low}). Each area loses at most ${CATEGORY_CAP} points. Notes cost nothing. ${report.mode === "scan" ? "This was a read-only scan: nothing was submitted." : ""}</p>
    <div class="pills">${sevPills}</div>
  </div>
</section>

<h2>Score breakdown</h2>
<table><thead><tr><th>Area</th><th>Health</th><th class="num">Score</th><th class="num">Lost</th></tr></thead><tbody>${catRows}</tbody></table>

<h2>Leaks and how to fix them</h2>
${findingCards}

${report.submissions.length ? `<h2>Test submissions</h2><div class="scroll"><table><thead><tr><th>Form</th><th>Result</th><th>What happened</th></tr></thead><tbody>${subRows}</tbody></table></div>` : ""}
${report.replies.length ? `<h2>Reply speed</h2><div class="scroll"><table><thead><tr><th>Form</th><th>First reply</th><th>Bucket</th></tr></thead><tbody>${replyRows}</tbody></table></div><p class="dim">Under 5 min great · under 1 h ok · over 1 h leak · none = dead.</p>` : report.mode === "submit" ? '<p class="dim">Reply timing was not measured (no IMAP access configured).</p>' : ""}

<h2>What was found</h2>
${inv.forms.length ? `<div class="scroll"><table><thead><tr><th>Form</th><th>Sends to</th><th>Fields</th><th>CAPTCHA</th><th>Honeypot</th></tr></thead><tbody>${formRows}</tbody></table></div>` : '<p class="dim">No forms found.</p>'}
${linkRows ? `<br><div class="scroll"><table><thead><tr><th>Type</th><th>Target</th><th>Status</th></tr></thead><tbody>${linkRows}</tbody></table></div>` : ""}

<footer>
<p>${esc(FOOTER_TEXT.split("https://")[0])}<a href="https://skynetjoe.com">https://skynetjoe.com</a></p>
<p>Scans are read-only. Test submissions are only sent with explicit confirmation of ownership. Credentials are never stored in this report.</p>
</footer>
</main>
</body>
</html>`;
}

export function writeReports(result, outDir, extra = {}) {
  const report = buildReport(result, extra);
  const json = JSON.stringify(report, null, 2);
  const html = renderHtml(report);
  const secrets = collectSecrets();
  assertNoSecrets(json, secrets);
  assertNoSecrets(html, secrets);
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "report.json");
  const htmlPath = path.join(outDir, "report.html");
  fs.writeFileSync(jsonPath, json);
  fs.writeFileSync(htmlPath, html);
  return { report, jsonPath, htmlPath };
}
