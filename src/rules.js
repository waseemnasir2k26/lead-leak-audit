import { assessForm } from './classify.js';
// Pure detectors and validators. No browser, no network: everything here is unit-tested.

export const E164 = /^\+[1-9]\d{6,14}$/;

const PLACEHOLDER_DIGITS =
  /^(?:\+?0+|\+?1234567890?|\+?123456789|\+?(\d)\1{6,})$/;
const PLACEHOLDER_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "yourdomain.com",
  "yourcompany.com",
  "domain.com",
  "email.com",
  "mysite.com",
  "website.com",
  "company.com",
  "test.com",
  "sample.com",
]);

/** Analyse a tel: href. */
export function analyzeTel(href) {
  let raw = String(href).replace(/^tel:/i, "");
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  raw = raw.split(/[;?]/)[0].trim();
  const compact = raw.replace(/[\s().-]/g, "");
  const out = {
    raw,
    normalized: compact,
    valid: false,
    e164: false,
    issue: null,
  };
  if (!compact) {
    out.issue = "empty";
    return out;
  }
  if (
    /[^+\d]/.test(compact) ||
    (compact.includes("+") && !compact.startsWith("+"))
  ) {
    out.issue = "invalid-characters";
    return out;
  }
  if (PLACEHOLDER_DIGITS.test(compact) || /555[-.\s]?01\d\d$/.test(raw)) {
    out.issue = "placeholder";
    return out;
  }
  if (E164.test(compact)) {
    out.valid = true;
    out.e164 = true;
    return out;
  }
  const digits = compact.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    out.issue = "bad-length";
    return out;
  }
  out.valid = true; // plausible local number
  out.issue = "not-international";
  return out;
}

/** Analyse a mailto: href. */
export function analyzeMailto(href) {
  const body = String(href).replace(/^mailto:/i, "");
  let address = body.split("?")[0];
  try {
    address = decodeURIComponent(address);
  } catch {
    /* keep */
  }
  const first = address.split(",")[0].trim();
  const out = { address: first, valid: false, issue: null, domain: null };
  if (!first) {
    out.issue = "empty";
    return out;
  }
  if (
    !/^[^\s@<>()[\],;:\\"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
      first,
    )
  ) {
    out.issue = "invalid-format";
    return out;
  }
  out.domain = first.split("@")[1].toLowerCase();
  if (
    PLACEHOLDER_EMAIL_DOMAINS.has(out.domain) ||
    /^(you|your|name|email|user|username)@/i.test(first)
  ) {
    out.issue = "placeholder";
    return out;
  }
  out.valid = true;
  return out;
}

/** Analyse a WhatsApp link (wa.me, api/web.whatsapp.com, whatsapp://). Never contacts WhatsApp. */
export function analyzeWhatsApp(href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return {
      kind: "unknown",
      valid: false,
      issue: "unparseable",
      number: null,
      text: null,
      prefilled: false,
      hasPlus: false,
    };
  }
  const host = u.hostname.toLowerCase();
  let number = null;
  const text = u.searchParams.get("text");
  let kind = "number";
  if (host === "wa.me" || host === "www.wa.me") {
    let seg = u.pathname.replace(/^\/+/, "").split("/")[0] || "";
    try {
      seg = decodeURIComponent(seg);
    } catch {
      /* keep */
    }
    if (["message", "qr", "c"].includes(seg)) kind = "short-link";
    else number = seg;
  } else {
    number = u.searchParams.get("phone");
    if (
      host === "chat.whatsapp.com" ||
      host === "wa.link" ||
      /^\/(?:channel|message|qr)/.test(u.pathname)
    )
      kind = "short-link";
  }
  const out = {
    kind,
    number,
    text,
    prefilled: !!(text && text.trim()),
    valid: true,
    issue: null,
    hasPlus: false,
  };
  if (kind === "short-link") return out;
  if (number === null || number === "") {
    out.valid = false;
    out.issue = "missing-number";
    return out;
  }
  out.hasPlus = number.startsWith("+");
  const digits = number.replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) {
    out.valid = false;
    out.issue = "non-numeric";
    return out;
  }
  if (/^0/.test(digits)) {
    out.valid = false;
    out.issue = "leading-zero";
    return out;
  }
  if (digits.length < 8 || digits.length > 15) {
    out.valid = false;
    out.issue = "bad-length";
    return out;
  }
  if (
    PLACEHOLDER_DIGITS.test(digits) ||
    (/^1?\d{3}555\d{4}$/.test(digits) && /5550(?:1\d\d)$/.test(digits))
  ) {
    out.valid = false;
    out.issue = "placeholder";
    return out;
  }
  if (out.hasPlus) out.issue = "plus-sign"; // WhatsApp documents the number without "+"
  return out;
}

/** True for any WhatsApp click-to-chat href. */
export function isWhatsAppHref(href) {
  return (
    /^(?:https?:\/\/)?(?:www\.)?(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|chat\.whatsapp\.com|wa\.link)(?:[/?#:]|$)/i.test(
      href,
    ) || /^whatsapp:\/\//i.test(href)
  );
}

export const BOOKING_VENDORS = [
  { vendor: "Calendly", re: /^https?:\/\/(?:www\.)?calendly\.com\//i },
  { vendor: "Cal.com", re: /^https?:\/\/(?:app\.|www\.)?cal\.com\//i },
  {
    vendor: "GoHighLevel",
    // Known GHL / LeadConnector hosts only. A white-labelled /widget/booking/ path counts only on the scanned site's own host (see bookingVendor).
    re: /^https?:\/\/(?:[^/]+\.)?(?:leadconnectorhq\.com|msgsndr\.com|gohighlevel\.com)\/.*(?:booking|appointment|calendar)/i,
  },
  {
    vendor: "Acuity",
    re: /^https?:\/\/(?:[^/]+\.)?(?:acuityscheduling\.com|as\.me)\//i,
  },
  {
    vendor: "Square Appointments",
    re: /^https?:\/\/(?:[^/]+\.)?square\.site\/.*book|squareup\.com\/appointments/i,
  },
  { vendor: "Setmore", re: /^https?:\/\/(?:[^/]+\.)?setmore\.com\//i },
];

export function bookingVendor(href, { ownHost = null } = {}) {
  for (const b of BOOKING_VENDORS) if (b.re.test(href)) return b.vendor;
  if (ownHost) {
    try {
      const u = new URL(href);
      if (hostKey(u.host) === hostKey(ownHost) && /^\/widget\/bookings?\//i.test(u.pathname)) return "GoHighLevel";
    } catch {
      /* not a URL */
    }
  }
  return null;
}

/**
 * Chat vendors. `src` matches script/iframe/resource URLs (and inline script text);
 * `dom` lists selectors that exist once the widget actually rendered.
 */
export const CHAT_VENDORS = [
  {
    vendor: "Intercom",
    src: [/widget\.intercom\.io/i, /js\.intercomcdn\.com/i, /intercomSettings/],
    dom: [
      ".intercom-lightweight-app",
      "#intercom-container",
      'iframe[name="intercom-launcher-frame"]',
      ".intercom-launcher",
    ],
  },
  {
    vendor: "Crisp",
    src: [/client\.crisp\.chat/i, /CRISP_WEBSITE_ID/],
    dom: [".crisp-client", "#crisp-chatbox"],
  },
  {
    vendor: "Tawk.to",
    src: [/embed\.tawk\.to/i, /Tawk_API/],
    dom: [
      'iframe[title*="chat widget" i]',
      "#tawk-bubble-container",
      'iframe[src*="tawk.to"]',
    ],
  },
  {
    vendor: "Tidio",
    src: [/code\.tidio\.co/i, /tidiochat/i],
    dom: ["#tidio-chat", "#tidio-chat-iframe"],
  },
  {
    vendor: "HubSpot",
    src: [
      /js\.hs-scripts\.com/i,
      /js\.usemessages\.com/i,
      /js-[a-z0-9]+\.hs-scripts\.com/i,
    ],
    dom: ["#hubspot-messages-iframe-container"],
  },
  {
    vendor: "Drift",
    src: [/js\.driftt\.com/i, /drift\.load\(/],
    dom: ["#drift-widget", "#drift-frame-controller", "iframe#drift-widget"],
  },
  {
    vendor: "LiveChat",
    src: [/cdn\.livechatinc\.com/i, /__lc\.license/],
    dom: [
      "#chat-widget-container",
      "#livechat-eye-catcher",
      "iframe#chat-widget",
    ],
  },
  {
    vendor: "Zendesk",
    src: [/static\.zdassets\.com/i, /ekr\.zdassets\.com/i, /v2\.zopim\.com/i],
    dom: [
      "iframe#launcher",
      "#ze-snippet",
      'iframe[data-product="web_widget"]',
    ],
  },
  {
    vendor: "GoHighLevel / LeadConnector",
    src: [
      /widgets\.leadconnectorhq\.com/i,
      /leadconnectorhq\.com\/loader/i,
      /chat-widget\.js/i,
    ],
    dom: [
      "chat-widget",
      ".lc_text-widget",
      "#lc_text-widget",
      'iframe[src*="leadconnectorhq" i]',
    ],
  },
  {
    vendor: "Facebook Messenger",
    src: [/connect\.facebook\.net\/.*customerchat/i, /xfbml\.customerchat/i],
    dom: [".fb-customerchat", 'iframe[title*="Messenger" i]'],
  },
];

export function detectChatVendors(urls = [], inlineText = "") {
  const found = [];
  for (const v of CHAT_VENDORS) {
    let hit = null;
    for (const re of v.src) {
      const u = urls.find((x) => re.test(x));
      if (u) {
        hit = u;
        break;
      }
      if (re.test(inlineText)) {
        hit = "(inline script)";
        break;
      }
    }
    if (hit)
      found.push({
        vendor: v.vendor,
        evidence: hit,
        srcPatterns: v.src,
        domSelectors: v.dom,
      });
  }
  return found;
}

export const CAPTCHA_SIGNS = [
  { kind: "reCAPTCHA", re: /recaptcha|g-recaptcha/i },
  { kind: "hCaptcha", re: /hcaptcha|h-captcha/i },
  {
    kind: "Cloudflare Turnstile",
    re: /turnstile|challenges\.cloudflare\.com/i,
  },
];

/** Decide whether a CAPTCHA is attached to a form from collected markers. */
export function detectCaptcha({ formMarkup = [], pageScripts = [] } = {}) {
  const hay = formMarkup.join(" ");
  for (const c of CAPTCHA_SIGNS)
    if (c.re.test(hay)) return { present: true, kind: c.kind, scope: "form" };
  for (const c of CAPTCHA_SIGNS)
    if (pageScripts.some((s) => c.re.test(s)))
      return { present: true, kind: c.kind, scope: "page" };
  return { present: false, kind: null, scope: null };
}

const HONEYPOT_NAME =
  /honey|hpot|(?:^|[-_])hp(?:[-_]|$)|bot[-_]?trap|nospam|do[-_]?not[-_]?fill|leave[-_]?blank|fax|website[-_]?url|url2/i;
export function isHoneypotField(f) {
  if (
    [
      "hidden",
      "submit",
      "button",
      "checkbox",
      "radio",
      "image",
      "reset",
    ].includes(f.type)
  )
    return false;
  if (f.visible) return false;
  const named = HONEYPOT_NAME.test(`${f.name || ""} ${f.id || ""}`);
  return (
    named ||
    !!f.offscreen ||
    !!f.ariaHidden ||
    !!f.tabindexNegative ||
    !!f.displayNone
  );
}

// Classification lives in classify.js (strict allow-list). These wrappers keep the older names.
export function classifyForm(form) {
  return assessForm(form).kind;
}

/** Why a form must never be submitted, or null. "other" and "search" are not dangerous, just not leads. */
export function forbiddenForm(form) {
  const a = assessForm(form);
  if (a.verdict !== 'reject' || a.kind === 'other' || a.kind === 'search') return null;
  return { kind: a.kind, why: a.reasons.join('; ') };
}

/** null when the form is a positive lead form, otherwise the reason it is not. */
export function leadEligibility(form) {
  const a = assessForm(form);
  return a.verdict === 'lead' ? null : a.reasons.join('; ') || 'not a lead form';
}

/** Stable signature so the same footer form on 15 pages counts as one form. */
export function formSignature(form) {
  const names = (form.fields || [])
    .filter((x) => x.type !== "submit")
    .map((x) => `${x.tag}:${x.type}:${x.name || x.id || ""}`)
    .sort()
    .join("|");
  const submitters = (form.submitActions || []).map((x) => x.action || "").join(",");
  return `${(form.method || "get").toLowerCase()} ${form.actionAbs || ""} ${form.id || ""} ${submitters} ${names}`;
}

/** Host comparison key: lowercase, no leading www., default ports dropped, other ports kept. */
export function hostKey(host) {
  let h = String(host || '').toLowerCase().trim().replace(/^www\./, '');
  h = h.replace(/:(?:80|443)$/, '');
  return h;
}
