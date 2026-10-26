// Test-lead submission with hard safety rails. Only ever run against sites you own.
import crypto from "node:crypto";
import { extractPage } from "./extract.js";
import {
  CHAT_VENDORS,
  detectCaptcha,
  hostKey,
  forbiddenForm,
  leadEligibility,
  isHoneypotField,
  classifyForm,
  formSignature,
} from "./rules.js";
import { VERSION } from "./scan.js";
import { forbiddenEndpoint } from "./guard.js";
import { assessForm, SAFE_NUMBER } from "./classify.js";

export const HARD_MAX_FORMS = 10;
export const TEST_NAME = "LEAD-LEAK-AUDIT TEST";
export const TEST_PHONE = "+15555550100"; // 555-01xx is reserved for fiction; E.164-valid, rings nobody

export class RailError extends Error {
  constructor(message) {
    super(message);
    this.name = "RailError";
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Gate 1: runs before a browser is even launched. Throws RailError. */
export function checkRails({ url, iOwn, email, allowDomains = [] }) {
  if (iOwn !== true) {
    throw new RailError(
      "Refusing to submit: pass --i-own-this-site to confirm you own this site or have written permission to test it.",
    );
  }
  if (!email || !EMAIL_RE.test(email)) {
    throw new RailError(
      "Refusing to submit: --email <test-inbox> is required (an inbox you control; it receives the auto-reply).",
    );
  }
  let host;
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).host;
  } catch {
    throw new RailError(`Refusing to submit: "${url}" is not a valid URL.`);
  }
  const allowed = new Set([
    hostKey(host),
    ...allowDomains.map(hostKey).filter(Boolean),
  ]);
  return { host: hostKey(host), allowed };
}

/** Gate 2: per host, used for the page, the form action and every non-GET request. */
export function assertHostAllowed(host, allowed) {
  if (!allowed.has(hostKey(host))) {
    throw new RailError(
      `Refusing: ${host} is not the audited host and is not in --allow-domain.`,
    );
  }
  return true;
}

export function isHostAllowed(host, allowed) {
  return allowed.has(hostKey(host));
}

export function newLeadId(rand = crypto.randomBytes(4)) {
  return `LLA-${Buffer.from(rand).toString("hex")}`;
}

export function testMessage(leadId) {
  return `This is an automated test of my own website, sent by lead-leak-audit (open source). Please ignore it; no follow-up is needed. Test ID: ${leadId}`;
}

/** Decide what to put in one field. Pure. */
export function valueFor(f, ctx) {
  const skip = (why) => ({ action: "skip", why });
  if (f.honeypot || isHoneypotField(f)) return skip("honeypot, left empty");
  if (["hidden", "submit", "button", "image", "reset"].includes(f.type))
    return skip("not a user field");
  if (f.type === "password") return skip("password field");
  if (f.type === "file")
    return f.required
      ? { action: "unfillable", why: "required file upload" }
      : skip("optional file upload");
  if (f.type === "radio")
    return f.required
      ? { action: "check", value: true }
      : skip("optional radio");
  if (f.type === "checkbox")
    return f.required
      ? { action: "check", value: true }
      : skip("optional checkbox");
  if (!f.visible)
    return f.required
      ? {
          action: "unfillable",
          why: `required field "${f.name || f.id}" is not visible`,
        }
      : skip("not visible");
  if (f.tag === "select") {
    const opts = (f.options || []).filter((o) => !o.disabled && o.value !== "");
    if (!opts.length)
      return f.required
        ? { action: "unfillable", why: "select has no usable option" }
        : skip("select has no usable option");
    return { action: "select", value: opts[0].value };
  }
  if (f.type === "email") return { action: "fill", value: ctx.email };
  if (f.type === "tel") return { action: "fill", value: TEST_PHONE };
  if (f.type === "url")
    return {
      action: "fill",
      value: "https://example.com/lead-leak-audit-test",
    };
  if (f.type === "number" || f.type === "range") {
    // Only number fields with a known harmless purpose are ever filled; anything else is left alone.
    if (SAFE_NUMBER.test(`${f.name} ${f.id} ${f.label} ${f.placeholder}`))
      return { action: "fill", value: "1" };
    return f.required
      ? {
          action: "unfillable",
          why: `required number field "${f.name || f.id}" of unknown purpose`,
        }
      : skip("number field of unknown purpose: never filled");
  }
  if (f.type === "date") return { action: "fill", value: ctx.today };
  if (f.type === "time") return { action: "fill", value: "10:00" };
  const hint = `${f.name} ${f.id} ${f.label} ${f.placeholder}`.toLowerCase();
  if (/e-?mail/.test(hint)) return { action: "fill", value: ctx.email };
  if (/phone|tel\b|mobile|whatsapp|cell/.test(hint))
    return { action: "fill", value: TEST_PHONE };
  if (
    f.tag === "textarea" ||
    /message|comment|enquiry|inquiry|details|question|how can|tell us|notes?\b/.test(
      hint,
    )
  )
    return { action: "fill", value: ctx.message };
  if (/first/.test(hint)) return { action: "fill", value: "LEAD-LEAK-AUDIT" };
  if (/last|surname|family/.test(hint))
    return { action: "fill", value: "TEST" };
  if (
    /company|business|organi[sz]ation|website|firm/.test(hint) &&
    !/name/.test(hint.replace(/(company|business|organi[sz]ation)\W*name/, ""))
  )
    return { action: "fill", value: TEST_NAME };
  if (/subject|topic|regarding/.test(hint))
    return { action: "fill", value: "Automated test (lead-leak-audit)" };
  if (/zip|postal|postcode/.test(hint))
    return { action: "fill", value: "10001" };
  if (/city|town/.test(hint)) return { action: "fill", value: "Test City" };
  if (/budget/.test(hint)) return { action: "fill", value: "N/A" };
  return {
    action: "fill",
    value: ctx.textOnlyNameField ? `${TEST_NAME} ${ctx.leadId}` : TEST_NAME,
  };
}

/** Full plan for one form. Pure: used by --dry-run and by the live run. */
export function planForm(
  form,
  { email, leadId, today = new Date().toISOString().slice(0, 10) },
) {
  const message = testMessage(leadId);
  const hasMessageField = form.fields.some((f) => f.tag === "textarea");
  const ctx = {
    email,
    leadId,
    message,
    today,
    textOnlyNameField: !hasMessageField,
  };
  const plan = [];
  const radioGroups = new Set();
  let carriesId = hasMessageField;
  for (const f of form.fields) {
    const r = valueFor(f, ctx);
    if (f.type === "radio" && r.action === "check") {
      if (radioGroups.has(f.name)) {
        plan.push({
          i: f.i,
          field: f.name || f.id || f.type,
          action: "skip",
          why: "radio group already chosen",
        });
        continue;
      }
      radioGroups.add(f.name);
    }
    if (
      r.action === "fill" &&
      typeof r.value === "string" &&
      r.value.includes(leadId)
    )
      carriesId = true;
    plan.push({
      i: f.i,
      field: f.name || f.id || f.type,
      type: f.type,
      action: r.action,
      value: r.value,
      why: r.why,
    });
  }
  // Make sure the unique ID travels with the lead so the reply can be matched to it.
  if (!carriesId) {
    const target = plan.find(
      (p) =>
        p.action === "fill" &&
        p.type !== "email" &&
        p.type !== "tel" &&
        p.type !== "number",
    );
    if (target) target.value = `${target.value} ${leadId}`;
  }
  return plan;
}

const SUCCESS_RE =
  /thank|thanks|success|received|has been sent|was sent|message sent|sent successfully|we(?:'| wi)ll (?:be in touch|get back|contact|respond|reply)|will get back|get back to you|in touch (?:soon|shortly)|submitted|appreciate|merci|message envoy|gracias|mensaje enviado|recibimos|obrigad[oa]|mensagem enviada|danke|nachricht gesendet|vielen dank|grazie|messaggio inviato|terima kasih|shukriya|شکریہ|شكرا|धन्यवाद|谢谢|感谢|收到|ありがとう|送信完了|送信しました|감사|고맙|접수/i; // CJK/Korean words: looks like success, so it is never accepted (allow-list above)
// "Fatal" wording means the page after submit is a crash page, not an answer: never "delivered", never a leak verdict.
const FATAL_RE =
  /fatal error|critical error|uncaught|stack ?trace|exception|internal server error|http error 5\d\d|\b5\d\d (?:error|internal)|traceback|undefined (?:index|variable)|syntax error/i;
// The ONE negative lexicon. Any cue here means the page does not say the lead was accepted.
// Word edges are letter lookarounds, not \b, so accented words ("échec") match. "n't" has no left edge
// because "can't" / "couldn't" / "wasn't" glue it to a letter. "invalid" only trips before a field word.
const NEG_WORDS = [
  // en
  "not",
  "no longer",
  "error",
  "errors",
  "fail(?:s|ed|ure|ing)?",
  "unable",
  "cannot",
  "could not",
  "problem",
  "problems",
  "issue",
  "issues",
  "try again",
  "went wrong",
  "rejected",
  "marked as spam",
  "invalid\\s+(?:email|e-?mail|phone|telephone|tel|number|field|name|address|input|message|captcha|postcode|zip|url)",
  "exception",
  "uncaught",
  "stack ?trace",
  "fatal error",
  "critical error",
  // es
  "no se pudo",
  "no se ha podido",
  "error al",
  "no pudimos",
  // fr
  "échec",
  "echec",
  "impossible",
  "erreur",
  "n'a pas pu",
  // de
  "nicht",
  "fehler",
  "leider",
  // pt
  "falhou",
  "erro",
  "não",
  // ur (Roman)
  "nahi hua",
  "nahin bheja",
  "masla",
  "ghalti",
  "dobara koshish",
];
export const ERROR_RE = new RegExp(
  `n['’]t(?!\\p{L})|(?<!\\p{L})(?:${NEG_WORDS.join("|")})(?!\\p{L})`,
  "iu",
);
// Statuses for which a real POST to the form action was sent in this run.
export const POSTED_STATUSES = new Set([
  "accepted",
  "accepted-redirect-blocked",
  "unconfirmed",
  "error-message",
  "failed",
  "timeout",
]);
const THANKS_URL =
  /thank|success|confirm|sent|received|done|merci|gracias|danke|grazie|obrigad/i;
// Home or index landing path (/, /home, /index, /index.html): a redirect there is never a confirmation.
const HOME_PATH_RE = /^\/(home|index(\.[a-z]{2,5})?)?\/?$/i;
function pathOf(u) {
  try {
    return new URL(u).pathname;
  } catch {
    return "";
  }
}

export function newLines(before, after) {
  const seen = new Set(
    String(before)
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean),
  );
  return String(after)
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !seen.has(l))
    .join("\n");
}

// JSON answer: {kind:"error"} when the server says it failed, {kind:"ok"} when it says it worked, else {kind:null}.
// values = every string value in the JSON, joined. Negative cues are scanned there, never in raw keys ("error": null is not a cue).
function jsonVerdict(body) {
  let v;
  try {
    v = JSON.parse(body);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const parts = [];
  const walk = (x) => {
    if (typeof x === "string") parts.push(x);
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(v);
  const values = parts.join("\n");
  if (Array.isArray(v)) return { kind: null, values };
  const filled = (x) =>
    x !== undefined &&
    x !== null &&
    x !== false &&
    x !== "" &&
    !(typeof x === "object" && !Object.keys(x).length);
  if (
    v.ok === false ||
    v.success === false ||
    (typeof v.status === "string" && /^error$/i.test(v.status)) ||
    filled(v.error) ||
    filled(v.errors)
  )
    return { kind: "error", values };
  if (v.ok === true || v.success === true) return { kind: "ok", values };
  return { kind: null, values };
}

const LATIN_SCRIPT = /\p{Script=Latin}/u;
const asNav = (e) => (typeof e === "string" ? { path: e, nav: false } : e);

// Allow-list language gate. "accepted" needs (a) a success phrase from a COVERED language's lexicon (English, Spanish,
// French, German, Portuguese) in the visible text, and (b) no letter outside the Latin script anywhere in the visible
// post-submit text. Any other success-looking text is "unconfirmed: confirmation not in a language this tool checks".
const COVERED_SUCCESS_RE =
  /thank|thanks|success|received|has been sent|was sent|message sent|sent successfully|we(?:'| wi)ll (?:be in touch|get back|contact|respond|reply)|will get back|get back to you|in touch (?:soon|shortly)|submitted|appreciate|merci|message envoy|gracias|mensaje enviado|recibimos|obrigad[oa]|mensagem enviada|danke|nachricht gesendet|vielen dank/i;
// True when any letter in the text is outside the Latin script (Japanese, Hangul, Han, Arabic script, Cyrillic, Greek, ...).
function hasNonLatinLetter(text) {
  for (const ch of String(text ?? ""))
    if (/\p{L}/u.test(ch) && !LATIN_SCRIPT.test(ch)) return true;
  return false;
}

/**
 * Pure verdict for one submission attempt. Without IMAP the best outcome is "accepted": positive evidence (a success
 * message, a thank-you URL, or JSON ok:true/success:true) AND no negative cue (ERROR_RE) in the visible text or JSON.
 * "delivered" is reserved for an IMAP-confirmed reply, applied in run.js. A blank page, a vanished form or a crash page is "unconfirmed".
 * relevant: [{method, url, status|null, failed?, abortedByUs?, error?, nav?, contentType?, body?}]
 */
export function classifyOutcome({
  relevant = [],
  blockedForeign = [],
  blockedForbidden = [],
  blockedRedirects = [],
  blockedNavs = [],
  finalHostForeign = null,
  validationBlocked = false,
  startUrl,
  finalUrl,
  textBefore = "",
  textAfter = "",
  formGone = false,
}) {
  const urlChanged =
    !!finalUrl &&
    /^https?:/i.test(finalUrl) &&
    finalUrl.split("#")[0] !== startUrl.split("#")[0];
  const evidence = relevant
    .map(
      (r) =>
        `${r.method} ${safePath(r.url)} -> ${r.failed ? "FAILED " + (r.error || "") : r.status === null ? "blocked" : r.status}`,
    )
    .join(" | ");
  const forbidden = blockedForbidden.map(asNav);
  const received = relevant.find(
    (r) => r.status !== null && r.status < 400 && !r.failed,
  );
  const where = (h, p) => `${h || ""}${p || ""}`;

  // The lead reached the server, then a safety rail stopped what came next: report exactly that.
  if (received) {
    if (blockedRedirects.length) {
      const r = blockedRedirects[0];
      // A 3xx only proves the server answered. Whether it went to a foreign host or a forbidden endpoint on the same host,
      // the thank-you page was never seen: unconfirmed, with the same manual-check note.
      const status = r.status ?? received.status;
      const detail =
        r.kind === "foreign"
          ? `unconfirmed: the site redirected to ${r.host}, which the safety rail blocked (HTTP ${status}). The server answered, but whether the lead was accepted is not shown. Check that host's thank-you page manually.`
          : r.kind === "resend"
            ? `unconfirmed: the site answered with a 307/308 re-send redirect to ${r.path}; the second submission was blocked to keep one lead per form. The server answered HTTP ${status}, and whether the lead was accepted is not shown. Check manually.`
            : `unconfirmed: the site redirected to ${r.path}, which the safety rail blocked (HTTP ${status}). The server answered, but whether the lead was accepted is not shown. Check manually.`;
      return {
        status: "unconfirmed",
        detail,
        evidence,
        http: status,
        blocked: where(r.host, r.path),
        redirectBlocked: true,
      };
    }
    const nav = blockedNavs[0] || forbidden.find((e) => e.nav);
    if (nav) {
      return {
        status: "accepted-redirect-blocked",
        detail: `received by your server (HTTP ${received.status}); the follow-up navigation to ${where(nav.host, nav.path)} was blocked by the safety rail. The confirmation page was not visited, so the visitor experience is unverified.`,
        evidence,
        http: received.status,
        blocked: where(nav.host, nav.path),
      };
    }
  }
  if (blockedRedirects.length) {
    const r = blockedRedirects[0];
    return {
      status: "skipped",
      detail:
        r.kind === "forbidden"
          ? `blocked: redirect to forbidden endpoint ${r.path} on ${r.host}. The server answered the submission with a redirect to an endpoint this tool never touches; the redirect was aborted in the browser.`
          : `blocked: redirect to foreign host ${r.host}. The server answered the submission with a redirect outside the allowed hosts; the redirect was aborted in the browser, so nothing was sent there and no confirmation can be verified.`,
      evidence,
    };
  }
  if (finalHostForeign) {
    return {
      status: "skipped",
      detail: `blocked: the result page is on a foreign host (${finalHostForeign}), so delivery cannot be confirmed and is not reported as delivered.`,
      evidence,
    };
  }
  if (forbidden.length) {
    const paths = [...new Set(forbidden.map((e) => e.path))]
      .slice(0, 3)
      .join(", ");
    return {
      status: "skipped",
      detail: `blocked: forbidden endpoint ${paths}. While submitting, the form (or a script on the page) tried to reach an endpoint this tool never touches (comments, cart, checkout, orders, payments, account, unsubscribe, delete, login, or a path robots.txt disallows). The request was aborted in the browser, so this form counts as not submitted.`,
      evidence,
    };
  }
  if (!relevant.length && blockedForeign.length) {
    return {
      status: "skipped",
      detail: `blocked: foreign host (${[...new Set(blockedForeign)].slice(0, 3).join(", ")}). The form tried to send data or navigate to a host outside the allowed list; the request was aborted in the browser and nothing reached that host. Add the host with --allow-domain only if it is yours.`,
      evidence,
    };
  }
  if (!relevant.length) {
    if (validationBlocked)
      return {
        status: "client-validation",
        detail:
          "The browser refused to submit because a required or typed field was invalid, even after filling. A real visitor could hit the same wall.",
        evidence,
      };
    const shown = newLines(textBefore, textAfter);
    if (SUCCESS_RE.test(shown))
      return {
        status: "unconfirmed",
        detail:
          "A success-style message appeared but no request to your site was observed. The message may be cosmetic, or the lead is sent from a third-party frame this tool cannot see.",
        evidence,
        confirmation: "message-only",
      };
    return {
      status: "no-request",
      detail:
        "Clicking submit sent nothing to the server and showed no message.",
      evidence,
    };
  }
  const failed = relevant.find((r) => r.failed && !r.abortedByUs);
  if (failed)
    return {
      status: "failed",
      detail: `The submission request failed (${failed.error || "network error"}) at ${safePath(failed.url)}.`,
      evidence,
      http: null,
    };
  const bad = relevant.find((r) => r.status >= 400);
  if (bad)
    return {
      status: "failed",
      detail: `The submission was answered with HTTP ${bad.status} at ${safePath(bad.url)}. The lead was not accepted.`,
      evidence,
      http: bad.status,
    };
  const last =
    relevant.filter((r) => r.status !== null).at(-1) ||
    relevant[relevant.length - 1];
  // Only text that was NOT on the pre-submit page counts, even after a redirect. Judging the whole destination page let
  // generic home-page text ("Thanks for visiting our site") count as a confirmation.
  const scope = newLines(textBefore, textAfter);
  const redirectUrl = urlChanged ? finalUrl : null;
  // A JSON answer decides for itself: ok:false, success:false, status:"error" or a filled error(s) key is an error, whatever the text says.
  const jsonRec = [...relevant]
    .reverse()
    .find((r) => r.body && /json/i.test(r.contentType || ""));
  const json = jsonRec ? jsonVerdict(jsonRec.body) : null;
  if (json?.kind === "error")
    return {
      status: "error-message",
      detail: `The form answered HTTP ${last.status} with a JSON error (ok, success or status says it failed, or an error field is set). The lead was not accepted.`,
      evidence,
      http: last.status,
      redirect: redirectUrl,
    };
  if (FATAL_RE.test(scope)) {
    return {
      status: "unconfirmed",
      serverError: true,
      detail: `The server answered HTTP ${last.status}, but the page shown afterwards looks like a crash page ("${firstLine(scope, FATAL_RE)}"). Delivery is unverified: the lead may or may not have been processed.`,
      evidence,
      http: last.status,
      redirect: redirectUrl,
    };
  }
  // "accepted" needs positive evidence AND no negative cue. Any negative cue: error-message without success wording, unconfirmed with it.
  // Negative cues: the visible text, or for JSON the string values only.
  const visible = json ? json.values : scope;
  const textSuccess = SUCCESS_RE.test(visible); // any language: decides whether the text LOOKS like success
  const urlConfirm = urlChanged && THANKS_URL.test(finalUrl); // supporting evidence only
  const jsonOk = json?.kind === "ok";
  const positive = textSuccess || urlConfirm || jsonOk;
  if (ERROR_RE.test(visible)) {
    return {
      status: positive ? "unconfirmed" : "error-message",
      detail: positive
        ? `The form answered HTTP ${last.status} and the page shows a success-style word together with an error cue ("${firstLine(visible, ERROR_RE)}"). Delivery is unverified and is not reported as accepted; re-test the form by hand.`
        : `The form answered HTTP ${last.status} but the page shows an error cue ("${firstLine(visible, ERROR_RE)}") and no success wording.`,
      evidence,
      http: last.status,
      redirect: redirectUrl,
    };
  }
  // Allow-list. (a) a covered-language success phrase in the visible text; (b) no non-Latin letter anywhere in the
  // visible post-submit text. A JSON answer that carries no text at all (a bare ok:true) has no language to check.
  const jsonText = json ? json.values : "";
  // After a redirect the success phrase must sit in a short, prominent new line (<= 200 chars), and a redirect to the
  // site's home or index page never counts: generic welcome text there is not a confirmation of this lead.
  const landedHome = urlChanged && HOME_PATH_RE.test(pathOf(finalUrl));
  const coveredSource = urlChanged
    ? visible
        .split("\n")
        .filter((l) => l.trim().length <= 200)
        .join("\n")
    : visible;
  const coveredHit = !landedHome && COVERED_SUCCESS_RE.test(coveredSource);
  const nonLatin = hasNonLatinLetter(`${textAfter}\n${jsonText}`);
  const structuredOk = jsonOk && !jsonText.trim();
  if (!nonLatin && (coveredHit || structuredOk)) {
    const seen = coveredHit
      ? `the visitor saw a confirmation${redirectUrl ? " on " + safePath(redirectUrl) : ""}`
      : "the server reported success in JSON";
    return {
      status: "accepted",
      detail: `Accepted by the site, not verified: run with --imap to confirm delivery. The server answered HTTP ${last.status} and ${seen}.`,
      evidence,
      http: last.status,
      redirect: redirectUrl,
      confirmation: coveredHit ? "message" : "json",
    };
  }
  if (landedHome && (textSuccess || COVERED_SUCCESS_RE.test(visible))) {
    return {
      status: "unconfirmed",
      detail: `unconfirmed: the site redirected to its home page (${safePath(finalUrl)}), which shows generic text. That text is not a confirmation of this lead. Check the thank-you page manually or use --imap.`,
      evidence,
      http: last.status,
      redirect: redirectUrl,
    };
  }
  // Anything else that looks like success (a success word in any language, or a thank-you page with text) is unconfirmed.
  if (textSuccess || (urlConfirm && scope.trim())) {
    return {
      status: "unconfirmed",
      detail: `unconfirmed: confirmation not in a language this tool checks. The server answered HTTP ${last.status}; whether the lead was accepted is not shown. Check manually or use --imap.`,
      evidence,
      http: last.status,
      redirect: redirectUrl,
    };
  }
  return {
    status: "unconfirmed",
    detail: `The server accepted the request (HTTP ${last.status}) but there is no positive evidence of delivery: no thank-you message and no thank-you page${formGone ? " (the form disappeared, which proves nothing)" : ""}.`,
    evidence,
    http: last.status,
    redirect: redirectUrl,
  };
}

function safePath(u) {
  try {
    const x = new URL(u);
    return x.pathname + (x.search ? "?…" : "");
  } catch {
    return String(u).slice(0, 60);
  }
}
function firstLine(t, re) {
  const m = String(t)
    .split("\n")
    .find((l) => re.test(l));
  return (m || "").slice(0, 120);
}

function formLabel(f) {
  const names = f.fields
    .filter(
      (x) =>
        x.visible &&
        !x.honeypot &&
        !["submit", "button", "hidden"].includes(x.type),
    )
    .map((x) => x.name || x.type)
    .slice(0, 3)
    .join("/");
  return `${f.kind}${names ? " (" + names + ")" : ""}`;
}

const NEVER_REASON = {
  comment: "comment form: submitting would publish a public comment",
  commerce: "cart, checkout, order or payment form: never submitted",
  account: "unsubscribe, delete, account or registration form: never submitted",
  "file-upload": "file upload form: never submitted",
  login: "login form: never submitted",
  search: "search form: never submitted",
};

/**
 * --only must name forms precisely: a 1-based number, "#id", ".class", or a text of at least 4 characters
 * (containing letters or digits) that appears in the form action, id or name. "", "/" and "." are refused,
 * so an unattended run can never end up selecting everything.
 */
export function validateOnly(only) {
  for (const raw of only || []) {
    const t = String(raw ?? "").trim();
    const ok =
      /^[1-9]\d*$/.test(t) ||
      /^#[A-Za-z0-9_:.-]+$/.test(t) ||
      /^\.[A-Za-z0-9_-]+$/.test(t) ||
      (t.length >= 4 && (t.match(/[A-Za-z0-9]/g) || []).length >= 3);
    if (!ok)
      throw new RailError(
        `--only "${raw}" is too broad or empty. Use an exact form number from --dry-run (for example 2), an #id, a .class, or at least 4 characters of the form action.`,
      );
  }
  return true;
}

/** --only matcher: a 1-based form number, #id, .class, or a substring of the form action / id / name. */
export function matchesOnly(form, index, only) {
  if (!only || !only.length) return true;
  return only.some((o) => {
    const t = String(o).trim();
    if (/^\d+$/.test(t)) return Number(t) === index;
    if (t.startsWith("#")) return form.id === t.slice(1);
    if (t.startsWith("."))
      return String(form.className || "")
        .split(/\s+/)
        .includes(t.slice(1));
    return [form.actionAbs, form.id, form.name].some(
      (v) => v && String(v).includes(t),
    );
  });
}

/**
 * Plan every submission (no network). Allow-list: only enquiry-style forms are ever planned.
 * Applies kind, newsletter, --only, robots, CAPTCHA, domain and cap rules, in that order.
 */
export function planSubmissions(
  inventory,
  {
    email,
    allowed,
    maxForms = HARD_MAX_FORMS,
    rand,
    includeNewsletter = false,
    only = [],
    robots = null,
  },
) {
  const cap = Math.min(Math.max(1, maxForms), HARD_MAX_FORMS);
  const indexed = inventory.forms.map((f, k) => ({ f, index: k + 1 }));
  indexed.sort(
    (a, b) =>
      (a.f.kind === "contact" ? 0 : 1) - (b.f.kind === "contact" ? 0 : 1) ||
      a.index - b.index,
  );
  const results = [];
  let used = 0;
  for (const { f, index } of indexed) {
    const base = {
      sig: f.sig,
      index,
      label: formLabel(f),
      page: f.firstPage,
      kind: f.kind,
      action: f.actionAbs,
      heading: f.heading || f.pageH1 || "",
      submitText: (f.submitTexts && f.submitTexts[0]) || f.submit?.text || "",
    };
    const skip = (reason, status = "skipped") =>
      results.push({ ...base, status, reason });
    const a = f.assessment || assessForm(f);
    base.kind = a.kind;
    base.positives = a.positives || [];
    if (a.verdict === "reject") {
      const first = a.reasons[0] || "not a lead form";
      skip(
        first.startsWith("forbidden endpoint")
          ? `blocked: ${first}`
          : `rejected as ${a.kind}: ${a.reasons.join("; ")}`,
      );
      continue;
    }
    if (a.verdict === "newsletter" && !includeNewsletter) {
      skip(
        "newsletter form: skipped because a test lead would subscribe the test inbox. Pass --include-newsletter to test it.",
      );
      continue;
    }
    if (!matchesOnly(f, index, only)) {
      skip("not selected by --only");
      continue;
    }
    let pageUrl = null;
    try {
      pageUrl = new URL(f.firstPage);
    } catch {
      /* handled below */
    }
    if (
      robots &&
      pageUrl &&
      !robots.isAllowed(pageUrl.pathname + pageUrl.search)
    ) {
      skip("robots.txt disallows this page, so it is not visited or submitted");
      continue;
    }
    const badUrl = [
      f.actionAbs,
      ...(f.submitActions || []).map((x) => x.action),
    ]
      .filter(Boolean)
      .map((u) =>
        forbiddenEndpoint(u, {
          robots,
          allowSignup: includeNewsletter && a.verdict === "newsletter",
        }),
      )
      .find(Boolean);
    if (badUrl) {
      skip(`blocked: forbidden endpoint ${badUrl.path} (${badUrl.why})`);
      continue;
    }
    if (used >= cap) {
      skip(`Over the ${cap}-form cap for one run; run again to test the rest.`);
      continue;
    }
    if (f.captcha.present) {
      results.push({
        ...base,
        status: "blocked-captcha",
        captcha: f.captcha.kind,
        reason: "Blocked by CAPTCHA, test manually.",
      });
      continue;
    }
    let actionHost = "";
    try {
      actionHost = new URL(f.actionAbs).host;
    } catch {
      /* no usable action */
    }
    if (actionHost && !isHostAllowed(actionHost, allowed)) {
      skip(
        `blocked: foreign host. The form action posts to ${actionHost}, which is not the audited host or in --allow-domain. Not submitted.`,
      );
      continue;
    }
    if (pageUrl && !isHostAllowed(pageUrl.host, allowed)) {
      skip(`blocked: foreign host. Page host ${pageUrl.host} is not allowed.`);
      continue;
    }
    used += 1; // exactly one slot per distinct form
    const leadId = newLeadId(rand);
    results.push({
      ...base,
      status: "planned",
      leadId,
      plan: planForm(f, { email, leadId }),
      form: f,
    });
  }
  return results.sort((a, b) => a.index - b.index);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the planned submissions in a real browser. One attempt per form, no retries.
 */
export async function runSubmissions(
  browser,
  planned,
  {
    allowed,
    settleMs = 1500,
    waitMs = 10000,
    log = () => {},
    robots = null,
    allowSignupForNewsletter = false,
    deadline = Infinity, // epoch ms: whole-run wall-clock cap
    formTimeoutMs = 90000, // per-form cap
    dwellMs = 6000, // minimum time between page load and submit (0 = off; also turns off human-pace typing)
  },
) {
  const out = [];
  for (const item of planned) {
    if (item.status !== "planned") {
      out.push(strip(item));
      continue;
    }
    if (Date.now() >= deadline) {
      out.push({
        ...strip(item),
        status: "skipped",
        reason:
          "run time cap reached before this form was tested (see --max-runtime); it was not submitted",
        timedOut: true,
      });
      continue;
    }
    log(`submit ${item.label} on ${item.page}`);
    out.push(
      await runOneForm(browser, item, {
        allowed,
        settleMs,
        waitMs,
        robots,
        allowSignupForNewsletter,
        dwellMs,
        formTimeoutMs: Math.min(
          formTimeoutMs,
          Math.max(5000, deadline - Date.now()),
        ),
      }),
    );
  }
  return out;
}

async function runOneForm(
  browser,
  item,
  {
    allowed,
    settleMs,
    waitMs,
    robots,
    allowSignupForNewsletter,
    formTimeoutMs,
    dwellMs,
  },
) {
  const t0 = Date.now();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: "block", // a service worker could answer or forward requests behind the route handler
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 lead-leak-audit/${VERSION}`,
  });
  const record = { ...strip(item), submittedAt: null };
  let timer;
  const work = doOneForm(ctx, item, record, {
    allowed,
    settleMs,
    waitMs,
    robots,
    allowSignupForNewsletter,
    dwellMs,
  });
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), formTimeoutMs);
  });
  try {
    const r = await Promise.race([work.then(() => "done"), timeout]);
    if (r === "timeout") {
      record.status = "timeout";
      record.detail = `The test of this form did not finish within ${Math.round(formTimeoutMs / 1000)}s and was stopped. The lead may or may not have been sent; check the form's inbox.`;
      record.timedOut = true;
    }
  } finally {
    clearTimeout(timer);
    work.catch(() => {});
    record.durationMs = Date.now() - t0;
    await ctx.close().catch(() => {});
  }
  return record;
}

async function doOneForm(
  ctx,
  item,
  record,
  { allowed, settleMs, waitMs, robots, allowSignupForNewsletter, dwellMs },
) {
  const blockedForeign = [];
  const blockedForbidden = [];
  const blockedRedirects = [];
  const chainFinal = []; // URLs the server redirected us through (we follow them ourselves)
  const blockedBeacons = []; // foreign GET/image/websocket traffic after arming: recorded, never sent
  const blockedNavs = []; // navigations (foreign or forbidden) stopped AFTER the click: what the page tried to do next
  const ours = new Set(); // requests WE aborted: not network errors of the site under test
  const hopStatus = new Map(); // request -> status the server really answered before we stopped the follow-up
  const abortOurs = (route, req, status) => {
    ours.add(req);
    if (status !== undefined) hopStatus.set(req, status);
    return route.abort("blockedbyclient");
  };
  let armed = false;
  let submissionsTried = 0; // non-GET requests to an allowed host after arming: only the first may leave

  await ctx.route("**/*", async (route) => {
    const req = route.request();
    let u;
    try {
      u = new URL(req.url());
    } catch {
      return route.continue();
    }
    if (!/^https?:$/.test(u.protocol)) return route.continue();
    const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(req.method());
    const nav = req.isNavigationRequest();
    const rt = req.resourceType();
    // 1. Host allow-list.
    if (!isHostAllowed(u.host, allowed)) {
      if (!safeMethod || nav) {
        blockedForeign.push(u.host);
        if (armed && nav)
          blockedNavs.push({ host: u.host, path: u.pathname, kind: "foreign" });
        return abortOurs(route, req);
      }
      if (armed) {
        blockedBeacons.push(
          `${rt} GET ${u.host}${u.pathname}${u.search ? "?…" : ""}`,
        );
        return abortOurs(route, req);
      }
      return route.continue();
    }
    // 1b. One submission per form. A page can fire two lead POSTs (a fetch() from a submit handler plus the native
    //     submit). The first non-GET after arming may proceed to the gates below; every later one is aborted here.
    if (armed && !safeMethod) {
      submissionsTried++;
      if (submissionsTried > 1) {
        blockedBeacons.push(
          `blocked: second submission for the same form (${req.method()} ${u.host}${u.pathname})`,
        );
        return abortOurs(route, req);
      }
    }
    // 2. Endpoint gate: judge what the request would DO by its real URL, whatever the DOM claimed.
    const judged =
      !safeMethod || (armed && (nav || rt === "fetch" || rt === "xhr"));
    if (judged) {
      const hit = forbiddenEndpoint(req.url(), {
        robots,
        allowSignup: item.kind === "newsletter" && allowSignupForNewsletter,
      });
      if (hit) {
        blockedForbidden.push({ path: hit.path, nav });
        return abortOurs(route, req);
      }
    }
    // 3. Redirect rail. The browser is never allowed to follow a 3xx on its own: every hop is fetched here
    //    with maxRedirects 0, checked against the host allow-list, the endpoint gate and robots.txt, and only
    //    the final response is handed back. A hop that fails any check is aborted and reported.
    if (!safeMethod || (armed && nav)) {
      let method = req.method();
      let body = req.postDataBuffer();
      let current = req.url();
      let resp;
      try {
        resp = await route.fetch({ maxRedirects: 0, timeout: 20000 });
      } catch {
        return route.abort("failed");
      }
      const firstStatus = resp.status();
      for (let hop = 0; hop < 8; hop++) {
        const status = resp.status();
        const loc = resp.headers().location;
        if (!(status >= 300 && status < 400 && loc)) break;
        let target;
        try {
          target = new URL(loc, current);
        } catch {
          return route.abort("blockedbyclient");
        }
        if (
          /^https?:$/.test(target.protocol) &&
          !isHostAllowed(target.host, allowed)
        ) {
          blockedRedirects.push({
            host: target.host,
            kind: "foreign",
            path: target.pathname,
            status: firstStatus,
          });
          return abortOurs(route, req, firstStatus);
        }
        const hit = forbiddenEndpoint(target.href, {
          robots,
          allowSignup: item.kind === "newsletter" && allowSignupForNewsletter,
        });
        if (hit) {
          blockedRedirects.push({
            host: target.host,
            kind: "forbidden",
            path: hit.path,
            status: firstStatus,
          });
          return abortOurs(route, req, firstStatus);
        }
        // 307/308 keep the method and the body: following one for the lead POST would submit the lead twice.
        // A non-safe request is never re-sent: the hop is aborted and reported.
        const keep = status === 307 || status === 308;
        if (keep && !["GET", "HEAD", "OPTIONS"].includes(method)) {
          blockedRedirects.push({
            host: target.host,
            kind: "resend",
            path: target.pathname,
            status: firstStatus,
          });
          return abortOurs(route, req, firstStatus);
        }
        // 301/302/303 turn a POST into a GET; 307/308 keep the method and the body (safe methods only reach here).
        const nextMethod = keep ? method : method === "HEAD" ? "HEAD" : "GET";
        const headers = { ...req.headers() };
        if (!keep || !body)
          for (const h of [
            "content-length",
            "content-type",
            "transfer-encoding",
          ])
            delete headers[h];
        delete headers.host;
        try {
          resp = await route.fetch({
            url: target.href,
            method: nextMethod,
            headers,
            postData: keep && body ? body : undefined,
            maxRedirects: 0,
            timeout: 20000,
          });
        } catch {
          return route.abort("failed");
        }
        method = nextMethod;
        if (!keep) body = null;
        current = target.href;
        chainFinal.push(current);
        if (hop === 7) return route.abort("blockedbyclient"); // redirect loop
      }
      return route.fulfill({ response: resp });
    }
    return route.continue();
  });
  // WebSockets to a host that is not allowed are closed without ever connecting.
  await ctx.routeWebSocket(/.*/, (ws) => {
    let host = "";
    try {
      host = new URL(ws.url()).host;
    } catch {
      /* unparseable */
    }
    if (host && isHostAllowed(host, allowed)) {
      ws.connectToServer();
    } else {
      blockedBeacons.push(`websocket ${host || ws.url()}`);
      ws.close();
    }
  });

  const page = await ctx.newPage();
  const relevant = [];
  const pending = new Map();
  const popups = [];
  let formMethod = item.form.method;

  // Watch the whole context, not one page: target=_blank and window.open results arrive in a NEW page whose
  // first request starts before any page-level listener could be attached.
  const isMainFrameNav = (r) => {
    if (!r.isNavigationRequest()) return false;
    try {
      return r.frame().parentFrame() === null;
    } catch {
      return true; // the frame of a popup's very first request is not available yet
    }
  };
  ctx.on("request", (r) => {
    let u;
    try {
      u = new URL(r.url());
    } catch {
      return;
    }
    if (!isHostAllowed(u.host, allowed)) return;
    const nonGet = !["GET", "HEAD", "OPTIONS"].includes(r.method());
    const nav = isMainFrameNav(r);
    if (nonGet || (nav && armed)) {
      const rec = {
        method: r.method(),
        url: r.url(),
        status: null,
        nav: nav && !nonGet,
      };
      pending.set(r, rec);
      relevant.push(rec);
    }
  });
  ctx.on("response", (r) => {
    const rec = pending.get(r.request());
    if (!rec) return;
    rec.status = r.status();
    rec.contentType = r.headers()["content-type"] || "";
    // A JSON answer to a real request is parsed by the classifier; read its body now, before the page goes away.
    if (
      !["GET", "HEAD", "OPTIONS"].includes(rec.method) &&
      /json/i.test(rec.contentType)
    )
      rec.bodyRead = r
        .text()
        .then((t) => {
          rec.body = String(t).slice(0, 20000);
        })
        .catch(() => {});
  });
  ctx.on("requestfailed", (r) => {
    const rec = pending.get(r);
    if (rec && ours.has(r)) {
      rec.abortedByUs = true; // our own safety rail, not a network error
      if (hopStatus.has(r)) rec.status = hopStatus.get(r);
    } else if (rec && rec.status === null) {
      rec.failed = true;
      rec.error = r.failure()?.errorText || "failed";
    }
  });
  ctx.on("page", (np) => {
    if (np !== page) popups.push(np);
  });

  try {
    await page.goto(item.page, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForLoadState("load", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(settleMs);
    const loadedAt = Date.now();
    assertHostAllowed(new URL(page.url()).host, allowed); // final host after redirects
    // The form may live in a same-origin iframe.
    const frame = item.form.frameUrl
      ? page.frames().find((fr) => fr.url() === item.form.frameUrl)
      : page.mainFrame();
    if (!frame)
      throw Object.assign(new Error("the frame holding this form is gone"), {
        soft: true,
      });
    const x = await frame.evaluate(extractPage, {
      chatSelectors: Object.fromEntries(
        CHAT_VENDORS.map((v) => [v.vendor, v.dom]),
      ),
    });
    // Find the form by its exact signature. A loose fallback is used only when it is unambiguous,
    // so a look-alike form can never be picked by mistake.
    const sigOf = (f) =>
      formSignature({
        ...f,
        frameUrl: item.form.frameUrl || "",
        fields: f.fields.map((fl) => ({ ...fl })),
      });
    let idx = x.forms.findIndex((f) => sigOf(f) === item.sig);
    if (idx < 0) {
      const loose = x.forms
        .map((f, k) => (sameForm(f, item.form) ? k : -1))
        .filter((k) => k >= 0);
      idx = loose.length === 1 ? loose[0] : -1;
    }
    if (idx < 0)
      throw Object.assign(new Error("form not found on page any more"), {
        soft: true,
      });
    const live = x.forms[idx];
    // Re-judge the LIVE form: the page may differ from what the scan saw.
    const liveForm = {
      ...live,
      fields: live.fields.map((fl) => ({
        ...fl,
        honeypot: isHoneypotField(fl),
      })),
      frameUrl: item.form.frameUrl || "",
      firstPage: page.url(),
      pageTitle: await page.title().catch(() => ""),
      pageH1: item.form.pageH1 || x.h1 || "",
    };
    const liveAssessment = assessForm(liveForm);
    if (
      liveAssessment.verdict === "reject" ||
      (liveAssessment.verdict === "newsletter" && item.kind !== "newsletter")
    ) {
      record.status = "skipped";
      record.reason = `Re-checked on the live page and rejected as ${liveAssessment.kind}: ${liveAssessment.reasons.join("; ")}`;
      return;
    }
    const cap = detectCaptcha({
      formMarkup: live.captchaMarkup,
      pageScripts: [...x.scripts, ...x.iframes, ...(x.resources || [])],
    });
    if (cap.present) {
      record.status = "blocked-captcha";
      record.captcha = cap.kind;
      record.reason = "Blocked by CAPTCHA, test manually.";
      return;
    }
    const unfillable = item.plan.find((p) => p.action === "unfillable");
    if (unfillable) {
      record.status = "skipped";
      record.reason = `Cannot fill the form: ${unfillable.why}.`;
      return;
    }
    formMethod = live.method;
    const formLoc = frame.locator("form").nth(idx);
    // form.elements also covers controls attached through form="id" outside the <form> tag.
    const controls = await formLoc.evaluateHandle((f) =>
      Array.from(f.elements).filter((e) =>
        /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName),
      ),
    );
    for (const p of item.plan) {
      try {
        const el = (await controls.getProperty(String(p.i))).asElement();
        if (!el) throw new Error("field not found");
        if (p.action === "fill") {
          // Human pace: focus, then type with a small delay, so scripts that watch input events see a person.
          if (
            dwellMs > 0 &&
            /^(text|email|tel|url|search|textarea)$/.test(p.type || "")
          ) {
            await el.fill("", { timeout: 4000 });
            await el.focus();
            await page.keyboard.type(p.value, { delay: 10 });
          } else await el.fill(p.value, { timeout: 4000 });
        } else if (p.action === "select")
          await el.selectOption(p.value, { timeout: 4000 });
        else if (p.action === "check")
          await el.check({ timeout: 4000, force: true });
      } catch (e) {
        p.error = String(e.message).split("\n")[0];
      }
    }
    // Time-trap defence: nobody fills and sends a form within a second of loading it.
    for (
      let left = dwellMs - (Date.now() - loadedAt);
      left > 0;
      left = dwellMs - (Date.now() - loadedAt)
    ) {
      await page.mouse
        .move(
          200 + Math.round(Math.random() * 400),
          200 + Math.round(Math.random() * 300),
          { steps: 4 },
        )
        .catch(() => {});
      await sleep(Math.min(left, 600));
    }
    const textBefore = await frame.evaluate(() =>
      document.body.innerText.slice(0, 8000),
    );
    const startUrl = frame.url();
    record.submittedAt = new Date().toISOString();
    const t1 = Date.now();
    relevant.length = 0;
    pending.clear();
    armed = true; // stays armed for the rest of this context's life
    const btn = formLoc
      .locator(
        'button[type="submit"], input[type="submit"], button:not([type])',
      )
      .first();
    if (await btn.count()) {
      await btn.click({ timeout: 5000 }).catch(async () => {
        // The click may have fired the submit before timing out. Only fall back
        // when nothing went out, so a form never receives two test leads.
        await sleep(1000);
        if (
          relevant.length === 0 &&
          popups.length === 0 &&
          page.url() === startUrl
        )
          await formLoc.evaluate((f) => f.requestSubmit()).catch(() => {});
      });
    } else {
      await formLoc.evaluate((f) => f.requestSubmit());
    }
    // Wait for a response (or the wait budget), then a short settle for redirects and rendering.
    const deadline = Date.now() + waitMs;
    while (
      Date.now() < deadline &&
      !relevant.some((r) => r.status !== null || r.failed)
    )
      await sleep(200);
    await sleep(1200);
    const resultPage = popups.filter((p) => !p.isClosed()).at(-1) || page;
    if (resultPage !== page)
      await resultPage
        .waitForLoadState("domcontentloaded", { timeout: 3000 })
        .catch(() => {});
    let validationBlocked = false;
    let formGone = false;
    let textAfter = "";
    try {
      // The result lands in the frame that held the form, or in the popup.
      const reader = resultPage === page ? frame : resultPage;
      textAfter = await reader.evaluate(() =>
        document.body.innerText.slice(0, 8000),
      );
      const state = await frame.evaluate((i) => {
        const f = document.querySelectorAll("form")[i];
        if (!f) return { gone: true, invalid: false };
        const r = f.getBoundingClientRect();
        return {
          gone:
            r.width === 0 ||
            r.height === 0 ||
            getComputedStyle(f).display === "none",
          invalid: !f.checkValidity(),
        };
      }, idx);
      formGone = state.gone;
      validationBlocked = state.invalid;
    } catch {
      formGone = true; // page navigated away mid-evaluate
    }
    let finalUrl =
      chainFinal.length && resultPage === page
        ? chainFinal[chainFinal.length - 1]
        : resultPage === page
          ? frame.url()
          : resultPage.url();
    // An aborted navigation leaves chrome-error://: that is not where the visitor "landed".
    if (/^chrome-error:/i.test(finalUrl))
      finalUrl = chainFinal.at(-1) || startUrl;
    let finalHostForeign = null;
    try {
      const fu = new URL(finalUrl);
      if (/^https?:$/.test(fu.protocol) && !isHostAllowed(fu.host, allowed))
        finalHostForeign = fu.host;
    } catch {
      /* about:blank and friends */
    }
    await Promise.race([
      Promise.all(relevant.map((r) => r.bodyRead).filter(Boolean)),
      sleep(3000),
    ]);
    const verdict = classifyOutcome({
      relevant,
      blockedForeign,
      blockedForbidden,
      blockedRedirects,
      blockedNavs,
      finalHostForeign,
      validationBlocked,
      startUrl,
      finalUrl,
      textBefore,
      textAfter,
      formGone,
    });
    Object.assign(record, verdict, {
      networkErrors: relevant
        .filter((r) => r.failed)
        .map((r) => `${r.method} ${safePath(r.url)}: ${r.error}`),
      respondedInMs: Date.now() - t1,
      blockedRequests: blockedBeacons.slice(0, 20),
      popups: popups.length,
    });
    if (submissionsTried > 1) {
      record.submissionsAttempted = submissionsTried;
      record.detail = `${record.detail} The page tried to send ${submissionsTried} submissions; only the first was let through.`;
    }
  } catch (err) {
    if (err instanceof RailError || err.soft) {
      record.status = "skipped";
      record.reason = err.message;
    } else {
      record.status = "failed";
      record.detail = `Could not complete the test: ${String(err.message).split("\n")[0]}`;
      record.evidence = null;
    }
  }
}

function sameForm(live, planned) {
  return (
    live.actionAbs === planned.actionAbs &&
    live.method === planned.method &&
    live.fields.length === planned.fields.length
  );
}

function strip(item) {
  const { form, ...rest } = item;
  void form;
  return rest;
}

export function summarizePlan(planned) {
  return planned.map((p) => ({
    index: p.index,
    kind: p.kind,
    heading: p.heading,
    submitText: p.submitText,
    positives: p.positives,
    form: p.label,
    page: p.page,
    status: p.status === "planned" ? "would-submit" : p.status,
    reason: p.reason,
    leadId: p.leadId,
    fields: (p.plan || [])
      .filter((f) => f.action !== "skip")
      .map((f) => ({ field: f.field, action: f.action, value: f.value })),
    skippedFields: (p.plan || [])
      .filter((f) => f.action === "skip")
      .map((f) => `${f.field} (${f.why})`),
  }));
}
