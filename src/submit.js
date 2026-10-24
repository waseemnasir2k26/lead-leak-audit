// Test-lead submission with hard safety rails. Only ever run against sites you own.
import crypto from "node:crypto";
import { extractPage } from "./extract.js";
import {
  CHAT_VENDORS,
  detectCaptcha,
  hostKey,
  isHoneypotField,
  classifyForm,
  formSignature,
} from "./rules.js";
import { VERSION } from "./scan.js";

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
  if (f.type === "number" || f.type === "range")
    return { action: "fill", value: "1" };
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
  if (/budget|price|amount/.test(hint)) return { action: "fill", value: "1" };
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
  /thank|thanks|success|received|has been sent|was sent|message sent|we(?:'| wi)ll (?:be in touch|get back|contact|respond|reply)|get back to you|submitted|appreciate|merci|gracias|danke|terima kasih/i;
const ERROR_RE =
  /something went wrong|went wrong|failed|unable to|could not|couldn't|not sent|try again|error occurred|server error|invalid|spam/i;
const THANKS_URL =
  /thank|success|confirm|sent|received|done|merci|gracias|danke/i;

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

/**
 * Pure verdict for one submission attempt.
 * relevant: [{method, url, status|null, failed?, error?}]
 */
export function classifyOutcome({
  relevant = [],
  blockedForeign = [],
  validationBlocked = false,
  startUrl,
  finalUrl,
  textBefore = "",
  textAfter = "",
  formGone = false,
}) {
  const urlChanged =
    !!finalUrl && finalUrl.split("#")[0] !== startUrl.split("#")[0];
  const evidence = relevant
    .map(
      (r) =>
        `${r.method} ${safePath(r.url)} -> ${r.failed ? "FAILED " + (r.error || "") : r.status}`,
    )
    .join(" | ");
  if (!relevant.length && blockedForeign.length) {
    return {
      status: "skipped",
      detail: `The form tried to send data to a host outside the allowed list (${[...new Set(blockedForeign)].slice(0, 3).join(", ")}); the request was blocked. Add that host with --allow-domain if it is yours.`,
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
  const failed = relevant.find((r) => r.failed);
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
  const last = relevant[relevant.length - 1];
  const scope = urlChanged ? textAfter : newLines(textBefore, textAfter);
  const redirectUrl = urlChanged ? finalUrl : null;
  if (ERROR_RE.test(scope) && !SUCCESS_RE.test(scope)) {
    return {
      status: "error-message",
      detail: `The form answered HTTP ${last.status} but the page now shows an error message: "${firstLine(scope.match(ERROR_RE) ? scope : "")}".`,
      evidence,
      http: last.status,
      redirect: redirectUrl,
    };
  }
  const textConfirm = SUCCESS_RE.test(scope);
  const urlConfirm = urlChanged && THANKS_URL.test(finalUrl);
  if (
    textConfirm ||
    urlConfirm ||
    (urlChanged && formGone) ||
    (!urlChanged && formGone)
  ) {
    return {
      status: "delivered",
      detail: `Accepted (HTTP ${last.status}) and the visitor saw a confirmation${redirectUrl ? " on " + safePath(redirectUrl) : ""}.`,
      evidence,
      http: last.status,
      redirect: redirectUrl,
      confirmation: textConfirm
        ? "message"
        : urlConfirm
          ? "thank-you-url"
          : "form-replaced",
    };
  }
  return {
    status: "unconfirmed",
    detail: `The server accepted the request (HTTP ${last.status}) but the visitor saw no confirmation message and no thank-you page.`,
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
function firstLine(t) {
  const m = String(t)
    .split("\n")
    .find((l) => ERROR_RE.test(l));
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

/**
 * Plan every submission (no network). Applies caps, kind filter and domain rail per form.
 */
export function planSubmissions(
  inventory,
  { email, allowed, maxForms = HARD_MAX_FORMS, rand },
) {
  const cap = Math.min(Math.max(1, maxForms), HARD_MAX_FORMS);
  const eligible = inventory.forms
    .filter((f) => f.kind === "contact" || f.kind === "newsletter")
    .sort(
      (a, b) => (a.kind === "contact" ? 0 : 1) - (b.kind === "contact" ? 0 : 1),
    );
  const others = inventory.forms.filter((f) => !eligible.includes(f));
  const results = [];
  let used = 0;
  for (const f of eligible) {
    const base = {
      sig: f.sig,
      label: formLabel(f),
      page: f.firstPage,
      kind: f.kind,
      action: f.actionAbs,
    };
    let actionHost = "";
    try {
      actionHost = new URL(f.actionAbs).host;
    } catch {
      /* handled below */
    }
    if (used >= cap) {
      results.push({
        ...base,
        status: "skipped",
        reason: `Over the ${cap}-form cap for one run; run again to test the rest.`,
      });
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
    if (actionHost && !isHostAllowed(actionHost, allowed)) {
      results.push({
        ...base,
        status: "skipped",
        reason: `Form action posts to ${actionHost}, which is not the audited host or in --allow-domain. Not submitted.`,
      });
      continue;
    }
    let pageHost = "";
    try {
      pageHost = new URL(f.firstPage).host;
    } catch {
      /* ignore */
    }
    if (pageHost && !isHostAllowed(pageHost, allowed)) {
      results.push({
        ...base,
        status: "skipped",
        reason: `Page host ${pageHost} is not allowed.`,
      });
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
  for (const f of others) {
    results.push({
      sig: f.sig,
      label: formLabel(f),
      page: f.firstPage,
      kind: f.kind,
      action: f.actionAbs,
      status: "skipped",
      reason: `${f.kind} form: never submitted.`,
    });
  }
  return results;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the planned submissions in a real browser. One attempt per form, no retries.
 */
export async function runSubmissions(
  browser,
  planned,
  { allowed, settleMs = 1500, waitMs = 10000, log = () => {} },
) {
  const out = [];
  for (const item of planned) {
    if (item.status !== "planned") {
      out.push(strip(item));
      continue;
    }
    log(`submit ${item.label} on ${item.page}`);
    const t0 = Date.now();
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 lead-leak-audit/${VERSION}`,
    });
    const blockedForeign = [];
    await ctx.route("**/*", (route) => {
      const req = route.request();
      let u;
      try {
        u = new URL(req.url());
      } catch {
        return route.continue();
      }
      const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(req.method());
      if (
        !safeMethod &&
        /^https?:$/.test(u.protocol) &&
        !isHostAllowed(u.host, allowed)
      ) {
        blockedForeign.push(u.host);
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    const page = await ctx.newPage();
    const relevant = [];
    const pending = new Map();
    let formMethod = item.form.method;
    page.on("request", (r) => {
      let u;
      try {
        u = new URL(r.url());
      } catch {
        return;
      }
      if (!isHostAllowed(u.host, allowed)) return;
      const nonGet = !["GET", "HEAD", "OPTIONS"].includes(r.method());
      const nav = r.isNavigationRequest() && r.frame() === page.mainFrame();
      if (nonGet || (formMethod === "get" && nav && armed)) {
        const rec = { method: r.method(), url: r.url(), status: null };
        pending.set(r, rec);
        relevant.push(rec);
      } else if (nav && armed) {
        const rec = {
          method: r.method(),
          url: r.url(),
          status: null,
          nav: true,
        };
        pending.set(r, rec);
        relevant.push(rec);
      }
    });
    page.on("response", (r) => {
      const rec = pending.get(r.request());
      if (rec) rec.status = r.status();
    });
    page.on("requestfailed", (r) => {
      const rec = pending.get(r);
      if (rec && rec.status === null) {
        rec.failed = true;
        rec.error = r.failure()?.errorText || "failed";
      }
    });
    let armed = false;
    const record = { ...strip(item), submittedAt: null };
    try {
      await page.goto(item.page, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await page.waitForLoadState("load", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(settleMs);
      assertHostAllowed(new URL(page.url()).host, allowed); // final host after redirects
      const x = await page.evaluate(extractPage, {
        chatSelectors: Object.fromEntries(
          CHAT_VENDORS.map((v) => [v.vendor, v.dom]),
        ),
      });
      const idx = x.forms.findIndex(
        (f) =>
          formSignature({ ...f, fields: f.fields.map((fl) => ({ ...fl })) }) ===
            item.sig || sameForm(f, item.form),
      );
      if (idx < 0)
        throw Object.assign(new Error("form not found on page any more"), {
          soft: true,
        });
      const live = x.forms[idx];
      const cap = detectCaptcha({
        formMarkup: live.captchaMarkup,
        pageScripts: [...x.scripts, ...x.iframes, ...(x.resources || [])],
      });
      if (cap.present) {
        record.status = "blocked-captcha";
        record.captcha = cap.kind;
        record.reason = "Blocked by CAPTCHA, test manually.";
        out.push(record);
        continue;
      }
      const unfillable = item.plan.find((p) => p.action === "unfillable");
      if (unfillable) {
        record.status = "skipped";
        record.reason = `Cannot fill the form: ${unfillable.why}.`;
        out.push(record);
        continue;
      }
      formMethod = live.method;
      const formLoc = page.locator("form").nth(idx);
      const fieldLoc = formLoc.locator("input, select, textarea");
      for (const p of item.plan) {
        try {
          const el = fieldLoc.nth(p.i);
          if (p.action === "fill") await el.fill(p.value, { timeout: 4000 });
          else if (p.action === "select")
            await el.selectOption(p.value, { timeout: 4000 });
          else if (p.action === "check")
            await el.check({ timeout: 4000, force: true });
        } catch (e) {
          p.error = String(e.message).split("\n")[0];
        }
      }
      const textBefore = await page.evaluate(() =>
        document.body.innerText.slice(0, 8000),
      );
      const startUrl = page.url();
      record.submittedAt = new Date().toISOString();
      const t1 = Date.now();
      relevant.length = 0;
      pending.clear();
      armed = true;
      const btn = formLoc
        .locator(
          'button[type="submit"], input[type="submit"], button:not([type])',
        )
        .first();
      if (await btn.count()) {
        await btn.click({ timeout: 5000 }).catch(async () => {
          await formLoc.evaluate((f) => f.requestSubmit());
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
      armed = false;
      let validationBlocked = false;
      let formGone = false;
      let textAfter = "";
      try {
        textAfter = await page.evaluate(() =>
          document.body.innerText.slice(0, 8000),
        );
        const state = await page.evaluate((i) => {
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
      const verdict = classifyOutcome({
        relevant,
        blockedForeign,
        validationBlocked,
        startUrl,
        finalUrl: page.url(),
        textBefore,
        textAfter,
        formGone,
      });
      Object.assign(record, verdict, {
        networkErrors: relevant
          .filter((r) => r.failed)
          .map((r) => `${r.method} ${safePath(r.url)}: ${r.error}`),
        respondedInMs: Date.now() - t1,
      });
    } catch (err) {
      if (err instanceof RailError) {
        record.status = "skipped";
        record.reason = err.message;
      } else if (err.soft) {
        record.status = "skipped";
        record.reason = err.message;
      } else {
        record.status = "failed";
        record.detail = `Could not complete the test: ${String(err.message).split("\n")[0]}`;
        record.evidence = null;
      }
    } finally {
      record.durationMs = Date.now() - t0;
      await ctx.close().catch(() => {});
    }
    out.push(record);
  }
  return out;
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
