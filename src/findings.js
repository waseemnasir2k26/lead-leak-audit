// Turns an inventory + network checks into leaks (severity, plain-English fix). Pure and unit-tested.
import { leadPathCount } from "./inventory.js";
import { speedBucket } from "./score.js";

let counter = 0;
function mk(o) {
  counter += 1;
  return { n: counter, evidence: null, where: [], ...o };
}

const short = (u, n = 80) => (u.length > n ? u.slice(0, n - 1) + "…" : u);
const contactish =
  /contact|quote|book|appointment|enquir|inquir|get-in-touch|reach|support|demo|schedule|consult/i;

/**
 * @param inventory output of buildInventory
 * @param checks {links: Record<href,result>, mx: Record<domain,result>, actions: Record<url,result>}
 * @param opts {origin, homepage}
 */
export function deriveFindings(inventory, checks = {}, opts = {}) {
  counter = 0;
  const posted = opts.postedActions || new Set();
  const out = [];
  const links = checks.links || {};
  const mx = checks.mx || {};
  const actions = checks.actions || {};
  const home = inventory.pages[0];
  const isHttps = /^https:/i.test(opts.origin || "");

  // Coverage ----------------------------------------------------------
  if (leadPathCount(inventory) === 0) {
    out.push(
      mk({
        id: "no-lead-path",
        severity: "critical",
        category: "coverage",
        title: "No way to contact you was found",
        detail: `Crawled ${inventory.pages.length} page(s) and found no form, email link, phone link, WhatsApp link, booking link or chat widget.`,
        fix: "Add at least one visible contact route (a form or a phone/WhatsApp link) in the header and on the home page. If the site is built in JavaScript, check the scan is not being blocked or timing out.",
      }),
    );
  }
  for (const p of inventory.pages) {
    if (p.status >= 400 && contactish.test(p.url)) {
      out.push(
        mk({
          id: "contact-page-broken",
          severity: "high",
          category: "coverage",
          title: "A contact-style page returns an error",
          detail: `${short(p.url)} answered HTTP ${p.status}.`,
          fix: "Restore the page or remove/redirect every link pointing to it. Visitors who click it hit a dead end.",
          where: [p.url],
        }),
      );
    }
  }

  for (const e of inventory.embeds || []) {
    out.push(
      mk({
        id: "embedded-third-party-form",
        severity: "info",
        category: "forms",
        title: `Embedded third-party form (${e.host})`,
        detail: `A form from ${e.host} is embedded in an iframe. Its fields live in another origin, so this tool cannot read or test it.`,
        fix: "Submit it by hand once a month and confirm the lead and the auto-reply arrive.",
        where: [e.page],
      }),
    );
  }

  // Forms -------------------------------------------------------------
  for (const f of inventory.forms) {
    if (f.kind !== "contact" && f.kind !== "newsletter") continue;
    const name = `${f.kind} form (${
      f.fields
        .filter(
          (x) =>
            x.visible &&
            !x.honeypot &&
            !["submit", "button", "hidden"].includes(x.type),
        )
        .map((x) => x.name || x.type)
        .slice(0, 4)
        .join(", ") || "no visible fields"
    })`;
    const where = f.pages;
    const ev = `action=${f.actionAttr === null ? "(none)" : short(f.actionAttr)} method=${f.method}`;
    const a = actions[f.actionAbs];
    if (a) {
      const probeDead =
        a.status === 404 || a.status === 410 || (a.status === 0 && a.error);
      if (probeDead && posted.has(f.actionAbs)) {
        // The HEAD probe is not the lead path: a real POST to this action was sent in this run, so its result decides.
        out.push(
          mk({
            id: "form-action-probe-info",
            severity: "info",
            category: "forms",
            title:
              "GET not allowed on the form endpoint, normal for POST-only handlers",
            detail: `The ${name} posts to ${short(f.actionAbs)}. A HEAD probe returned ${a.status ? "HTTP " + a.status : "an error (" + a.error + ")"}, but a real test POST to that address was sent in this run; the submission result below is the one that counts.`,
            fix: "No action for the probe itself. Check the submission result for this form.",
            where,
            evidence: ev,
          }),
        );
      } else if (probeDead) {
        out.push(
          mk({
            id: "form-action-dead",
            severity: "critical",
            category: "forms",
            title: `Form posts to an address that does not exist`,
            detail: `The ${name} sends leads to ${short(f.actionAbs)}, which ${a.status ? "returns HTTP " + a.status : "could not be reached (" + a.error + ")"}. Every submission is lost.`,
            fix: "Point the form action at a working handler (your form plugin, CRM webhook or serverless function) and re-test with the `submit` command.",
            where,
            evidence: ev,
          }),
        );
      } else if (a.status >= 500) {
        out.push(
          mk({
            id: "form-action-error",
            severity: "medium",
            category: "forms",
            title: "Form handler answers with a server error",
            detail: `${short(f.actionAbs)} returned HTTP ${a.status} to a harmless HEAD request. Some servers do this for HEAD only, so confirm with a real test.`,
            fix: "Run `lead-leak-audit submit` on a site you own to see what a real submission does, then check the handler logs.",
            where,
            evidence: ev,
          }),
        );
      }
    }
    if (isHttps && /^http:/i.test(f.actionAbs || "")) {
      out.push(
        mk({
          id: "form-action-insecure",
          severity: "high",
          category: "forms",
          title: "Form posts over plain HTTP from a secure page",
          detail: `Browsers block or warn on this, so submissions can fail silently. Action: ${short(f.actionAbs)}.`,
          fix: "Change the form action to an https:// address.",
          where,
          evidence: ev,
        }),
      );
    }
    if (
      (f.actionAttr === null ||
        f.actionAttr === "" ||
        f.actionAttr === "#" ||
        /^javascript:/i.test(f.actionAttr)) &&
      !f.hasOnsubmit
    ) {
      out.push(
        mk({
          id: "form-js-only",
          severity: "info",
          category: "forms",
          title: "Form has no action and depends on JavaScript",
          detail: `The ${name} cannot be verified by a read-only scan because it submits through scripts.`,
          fix: "Run `lead-leak-audit submit` (on your own site) to confirm a real submission reaches you.",
          where,
          evidence: ev,
        }),
      );
    }
    if (!f.submit) {
      out.push(
        mk({
          id: "form-no-submit",
          severity: "medium",
          category: "forms",
          title: "Form has no submit button",
          detail: `The ${name} has no button or submit input, so visitors may not know how to send it.`,
          fix: "Add a clearly labelled submit button.",
          where,
        }),
      );
    }
    if (
      f.kind === "contact" &&
      !f.fields.some(
        (x) =>
          !x.honeypot &&
          (x.type === "email" ||
            x.type === "tel" ||
            /e-?mail|phone|mobile|whatsapp/i.test(
              `${x.name} ${x.label} ${x.placeholder}`,
            )),
      )
    ) {
      out.push(
        mk({
          id: "form-no-reply-channel",
          severity: "medium",
          category: "forms",
          title: "Form does not ask how to reply",
          detail: `The ${name} has no email or phone field. You cannot answer a lead you cannot reach.`,
          fix: "Add a required email or phone field.",
          where,
        }),
      );
    }
    if (f.required > 6) {
      out.push(
        mk({
          id: "form-too-long",
          severity: "low",
          category: "forms",
          title: `Form has ${f.required} required fields`,
          detail: "Long required forms lose visitors before they finish.",
          fix: "Keep required fields to name, a way to reply and a message. Move the rest to a follow-up step.",
          where,
        }),
      );
    }
    if (f.captcha.present) {
      out.push(
        mk({
          id: "form-captcha",
          severity: "info",
          category: "forms",
          title: `${f.captcha.kind} protects this form`,
          detail:
            "The audit never solves or bypasses CAPTCHAs, so this form cannot be tested automatically.",
          fix: "Test it by hand once a month. Aggressive CAPTCHA settings are a common reason real leads are rejected.",
          where,
        }),
      );
    }
    const exc = f.jsErrors.filter((j) => j.class === "exception");
    const con = f.jsErrors.filter((j) => j.class === "console");
    const res = f.jsErrors.filter((j) => j.class === "resource");
    if (exc.length)
      out.push(
        mk({
          id: "form-js-exception",
          severity: "high",
          category: "forms",
          title: "Uncaught JavaScript error on a page with a form",
          detail: `"${exc[0].text}". A script crash can stop the form from submitting.`,
          fix: "Open the page, check the browser console, and fix or remove the failing script. Re-test the form afterwards.",
          where: [...new Set(exc.map((j) => j.page))],
        }),
      );
    else if (con.length)
      out.push(
        mk({
          id: "form-console-error",
          severity: "medium",
          category: "forms",
          title: "Console errors on a page with a form",
          detail: `"${con[0].text}"`,
          fix: "Check whether the error comes from the form script or a plugin that loads before it.",
          where: [...new Set(con.map((j) => j.page))],
        }),
      );
    else if (res.length)
      out.push(
        mk({
          id: "form-resource-error",
          severity: "low",
          category: "forms",
          title: "A resource fails to load on a page with a form",
          detail: `"${res[0].text}"`,
          fix: "Fix the broken file reference; if it is the form script, the form may not work.",
          where: [...new Set(res.map((j) => j.page))],
        }),
      );
    if (f.submit) {
      if (f.submit.covered)
        out.push(
          mk({
            id: "form-submit-covered",
            severity: "high",
            category: "mobile",
            title: "Another element covers the submit button on mobile",
            detail:
              "A banner, chat bubble or overlay sits on top of the button, so taps may not reach it.",
            fix: "Move the overlay or add bottom padding so the submit button can be tapped.",
            where,
          }),
        );
      else if (f.submit.visible && (f.submit.h < 36 || f.submit.w < 36))
        out.push(
          mk({
            id: "form-submit-small",
            severity: "medium",
            category: "mobile",
            title: "Submit button is hard to tap on mobile",
            detail: `It measures ${f.submit.w}x${f.submit.h}px. Aim for at least 44px high.`,
            fix: "Increase the button height and padding.",
            where,
          }),
        );
    }
    if (!f.visibleOnMobile)
      out.push(
        mk({
          id: "form-hidden-mobile",
          severity: "medium",
          category: "mobile",
          title: "Form is not visible on a phone-sized screen",
          detail:
            "It exists in the page but is hidden at 390px wide (it may sit in a closed popup or tab).",
          fix: "Make sure phone visitors have a visible way to open or see the form.",
          where,
        }),
      );
  }

  // Email / phone -----------------------------------------------------
  for (const m of inventory.mailto) {
    const a = m.analysis;
    if (!a.valid) {
      out.push(
        mk({
          id: "mailto-invalid",
          severity: "high",
          category: "email",
          title:
            a.issue === "placeholder"
              ? "Email link still uses a placeholder address"
              : "Email link is not a valid address",
          detail: `${short(m.href)} (${a.issue}). Clicking it writes to nowhere.`,
          fix: "Replace it with your real address.",
          where: m.pages,
        }),
      );
      continue;
    }
    const r = mx[a.domain];
    if (r && r.ok === false)
      out.push(
        mk({
          id: "mailto-no-mx",
          severity: "critical",
          category: "email",
          title: `${a.domain} cannot receive email`,
          detail: `No mail server (MX) and no address record exists for ${a.domain}, so mail sent to ${a.address} bounces.`,
          fix: "Fix the domain DNS (MX records) or change the address on the site to one that works.",
          where: m.pages,
        }),
      );
  }
  for (const t of inventory.tel) {
    const a = t.analysis;
    if (!a.valid)
      out.push(
        mk({
          id: "tel-invalid",
          severity: "high",
          category: "email",
          title:
            a.issue === "placeholder"
              ? "Phone link uses a placeholder number"
              : "Phone link is not a dialable number",
          detail: `${short(t.href)} (${a.issue}).`,
          fix: "Use the real number in international format, for example tel:+14155552671.",
          where: t.pages,
        }),
      );
    else if (!a.e164)
      out.push(
        mk({
          id: "tel-not-international",
          severity: "low",
          category: "email",
          title: "Phone link is not in international (E.164) format",
          detail: `${short(t.href)} may fail when tapped from another country or from some messaging apps.`,
          fix: "Write it as tel:+<country code><number> with no spaces or brackets.",
          where: t.pages,
        }),
      );
  }

  // WhatsApp ----------------------------------------------------------
  for (const w of inventory.whatsapp) {
    const a = w.analysis;
    if (!a.valid) {
      out.push(
        mk({
          id: "wa-bad-number",
          severity: "high",
          category: "whatsapp",
          title: "WhatsApp button points to a number that cannot work",
          detail: `${short(w.href)} (${a.issue}). WhatsApp expects digits only, with the country code and no leading zeros.`,
          fix: "Use https://wa.me/<countrycode><number> with digits only, for example https://wa.me/14155552671.",
          where: w.pages,
        }),
      );
      continue;
    }
    if (a.issue === "plus-sign")
      out.push(
        mk({
          id: "wa-plus-sign",
          severity: "low",
          category: "whatsapp",
          title: 'WhatsApp link contains a "+" in the number',
          detail: `${short(w.href)}. WhatsApp documents the number without a plus sign; some clients reject it.`,
          fix: "Remove the + from the link.",
          where: w.pages,
        }),
      );
    if (a.kind === "number" && !a.prefilled)
      out.push(
        mk({
          id: "wa-no-prefill",
          severity: "low",
          category: "whatsapp",
          title: "WhatsApp link has no prefilled message",
          detail: `${short(w.href)}. A prefilled text such as "Hi, I found you on your website" makes the first message one tap and tells you where it came from.`,
          fix: "Append ?text=Hi%2C%20I%20found%20you%20on%20your%20website.",
          where: w.pages,
        }),
      );
    const r = links[w.href];
    if (r && !r.ok && !r.inconclusive)
      out.push(
        mk({
          id: "wa-unresolved",
          severity: "high",
          category: "whatsapp",
          title: "WhatsApp link does not load",
          detail: `${short(w.href)} ${r.status ? "returned HTTP " + r.status : "could not be reached (" + r.error + ")"}.`,
          fix: "Check the link for typos and open it from a phone.",
          where: w.pages,
        }),
      );
  }

  // Chat --------------------------------------------------------------
  for (const c of inventory.chat) {
    if (!c.rendered) {
      const failed = c.requestFailures.length > 0;
      out.push(
        mk({
          id: failed ? "chat-script-failed" : "chat-not-rendered",
          severity: failed ? "high" : "medium",
          category: "chat",
          title: `${c.vendor} chat widget is installed but never appears`,
          detail: failed
            ? `The ${c.vendor} script request failed (${short(c.requestFailures[0].url, 70)} ${c.requestFailures[0].status || "network error"}).`
            : `The ${c.vendor} script is on the page but no chat bubble or frame was found in the page after it loaded. It may be off by schedule, hidden by consent settings, or misconfigured.`,
          fix: `Open the page on a phone and look for the ${c.vendor} bubble. If it is missing, check the widget ID, domain allow-list and business-hours settings in ${c.vendor}.`,
          where: c.missingOn,
        }),
      );
    }
  }

  // Booking -----------------------------------------------------------
  for (const b of inventory.booking) {
    const r = links[b.href];
    if (!r) continue;
    if (!r.ok && r.inconclusive)
      out.push(
        mk({
          id: "booking-unverified",
          severity: "info",
          category: "booking",
          title: `${b.vendor} link could not be verified`,
          detail: r.skipped
            ? `${short(b.href)} was not requested: ${r.error}.`
            : `${short(b.href)} answered HTTP ${r.status} to an automated request. Vendors often block bots.`,
          fix: "Open the link by hand to confirm it works.",
          where: b.pages,
        }),
      );
    else if (!r.ok)
      out.push(
        mk({
          id: "booking-dead",
          severity: "high",
          category: "booking",
          title: `${b.vendor} booking link is dead`,
          detail: `${short(b.href)} ${r.status ? "returned HTTP " + r.status : "could not be reached (" + r.error + ")"}.`,
          fix: "Update the link to the live booking page. Visitors who want to book cannot.",
          where: b.pages,
        }),
      );
  }

  // Mobile page signals -----------------------------------------------
  if (home?.cta && home.cta.aboveFold === false) {
    out.push(
      mk({
        id: "no-cta-above-fold",
        severity: "medium",
        category: "mobile",
        title: "No contact call-to-action in the first phone screen",
        detail:
          "On a 390x844 screen, the home page shows no contact, call, book or WhatsApp button before the first scroll.",
        fix: 'Put one clear contact button (call, WhatsApp or "Get a quote") at the top of the home page on mobile.',
        where: [home.url],
      }),
    );
  }
  if (home?.horizontalOverflow)
    out.push(
      mk({
        id: "mobile-overflow",
        severity: "low",
        category: "mobile",
        title: "Home page is wider than a phone screen",
        detail: "Content overflows sideways, which makes buttons easy to miss.",
        fix: "Find the element wider than the viewport and constrain it.",
        where: [home.url],
      }),
    );

  return out;
}

/** Findings for one submission result (submit mode). */
export function submissionFindings(sub, { deadActions = new Set() } = {}) {
  const where = [sub.page];
  const label = `form ${sub.label}`;
  const out = [];
  switch (sub.status) {
    case "blocked-captcha":
      out.push(
        mk({
          id: "submit-blocked-captcha",
          severity: "info",
          category: "forms",
          title: `${label}: blocked by CAPTCHA, test manually`,
          detail: `${sub.captcha || "A CAPTCHA"} is present. The audit never solves or bypasses CAPTCHAs.`,
          fix: "Submit this form by hand and confirm the lead arrives and the auto-reply fires.",
          where,
        }),
      );
      break;
    case "skipped":
      out.push(
        mk({
          id: "submit-skipped",
          severity: "info",
          category: "forms",
          title: `${label}: not submitted`,
          detail: sub.reason,
          fix: "Nothing to do unless this is a lead form; then adjust --allow-domain or test it by hand.",
          where,
        }),
      );
      break;
    case "failed":
      if (deadActions.has(sub.action)) {
        out.push(
          mk({
            id: "submit-confirms-dead-action",
            severity: "info",
            category: "forms",
            title: `${label}: test submission confirmed the dead form address`,
            detail: sub.detail,
            fix: "See the critical finding about the form address; no separate action needed.",
            where,
            evidence: sub.evidence,
          }),
        );
        break;
      }
      out.push(
        mk({
          id: "submit-http-failed",
          severity: "critical",
          category: "forms",
          title: `${label}: the test lead was lost`,
          detail: sub.detail,
          fix: "Fix the form handler first; every real lead is hitting the same failure. Check handler logs and re-run `submit`.",
          where,
          evidence: sub.evidence,
        }),
      );
      break;
    case "timeout":
      out.push(
        mk({
          id: "submit-timeout",
          severity: "medium",
          category: "forms",
          title: `${label}: the test did not finish in time`,
          detail: sub.detail,
          fix: "Check the form by hand and look at the page for slow scripts or a handler that hangs. If the test lead arrived, the form works but is slow.",
          where,
        }),
      );
      break;
    case "no-request":
      out.push(
        mk({
          id: "submit-silent",
          severity: "high",
          category: "forms",
          title: `${label}: clicking submit did nothing`,
          detail: sub.detail,
          fix: "Open the page, fill the form and watch the browser console and network tab. A script error or a missing handler is the usual cause.",
          where,
        }),
      );
      break;
    case "client-validation":
      out.push(
        mk({
          id: "submit-validation-blocked",
          severity: "medium",
          category: "forms",
          title: `${label}: browser validation blocked the submit`,
          detail: sub.detail,
          fix: "Check for required fields that cannot be filled (hidden, custom-widget or mismatched types).",
          where,
        }),
      );
      break;
    case "accepted":
      // Counts as OK (info, no penalty) but carries the unverified note: the inbox was never checked.
      out.push(
        mk({
          id: "submit-accepted-unverified",
          severity: "info",
          category: "forms",
          title: `${label}: accepted by the site, delivery not verified`,
          detail: sub.detail,
          fix: "Run with --imap to confirm the lead reaches the test inbox. Until then this is an unverified pass.",
          where,
          evidence: sub.evidence,
        }),
      );
      break;
    case "accepted-redirect-blocked":
      out.push(
        mk({
          id: "submit-redirect-blocked",
          severity: "info",
          category: "forms",
          title: `${label}: received by your server; a follow-up redirect was blocked`,
          detail: sub.detail,
          fix: "Nothing to fix. The safety rail stopped the page from leaving the allowed hosts or reaching a forbidden endpoint, so the thank-you page itself was not checked. Open it by hand if you want to see it.",
          where,
          evidence: sub.evidence,
        }),
      );
      break;
    case "unconfirmed":
      if (sub.serverError) {
        out.push(
          mk({
            id: "submit-error-body",
            severity: "medium",
            category: "forms",
            title: `${label}: the page after submit looks like a crash page`,
            detail: sub.detail,
            fix: "Open the form, submit it by hand and read the page you land on. A PHP or server error after a successful save is common after plugin updates; a real failure means lost leads.",
            where,
            evidence: sub.evidence,
          }),
        );
        break;
      }
      out.push(
        mk({
          id: "submit-no-confirmation",
          severity: "high",
          category: "forms",
          title: `${label}: no confirmation shown to the visitor`,
          detail: sub.detail,
          fix: sub.redirectBlocked
            ? "Open the place the site redirected to, submit the form by hand and check its thank-you page. The tool did not visit it."
            : "Show a clear thank-you message or redirect to a thank-you page. Without it visitors resubmit or give up.",
          where,
          evidence: sub.evidence,
        }),
      );
      break;
    case "error-message":
      out.push(
        mk({
          id: "submit-error-shown",
          severity: "high",
          category: "forms",
          title: `${label}: the form showed an error`,
          detail: sub.detail,
          fix: "Read the error text and fix the handler. If it mentions spam or CAPTCHA, loosen the rule that rejected a clean submission.",
          where,
        }),
      );
      break;
    default:
      break; // delivered (IMAP-confirmed): good news, no finding
  }
  if (sub.networkErrors?.length) {
    out.push(
      mk({
        id: "submit-network-error",
        severity: "high",
        category: "forms",
        title: `${label}: network errors during submit`,
        detail: sub.networkErrors.slice(0, 3).join("; "),
        fix: "Check the third-party endpoint the form calls and any CORS or ad-blocker related failures.",
        where,
      }),
    );
  }
  return out;
}

export function replyFindings(replies) {
  const out = [];
  for (const r of replies) {
    const b = speedBucket(r.seconds);
    if (!b.severity) continue;
    out.push(
      mk({
        id: `reply-${b.bucket}`,
        severity: b.severity,
        category: "speed",
        title:
          r.seconds === null
            ? `${r.label}: no reply arrived`
            : `${r.label}: first reply took ${formatDuration(r.seconds)}`,
        detail:
          r.seconds === null
            ? `Nothing carrying the test ID reached the test inbox within ${r.waitedMinutes} minutes. Auto-reply is off, in spam, or the lead was never delivered.`
            : `Buckets: under 5 min great, under 1 h ok, over 1 h leak. This one is "${b.label}".`,
        fix:
          r.seconds === null
            ? "Turn on an instant auto-reply that confirms receipt and sets expectations, and check the spam folder of the test inbox."
            : "Add an instant automatic reply, then respond personally within the hour; most leads are lost to the first fast responder.",
        where: [r.page],
      }),
    );
  }
  return out;
}

export function formatDuration(s) {
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
