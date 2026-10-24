// STRICT ALLOW-LIST form classification.
//
// A form is a lead form only when it shows POSITIVE signals (an enquiry-style message field or
// contact wording, plus a way to reply) and NO negative signal anywhere a human would read it:
// button text, headings, labels, field names, select options, form attributes, page URL/title.
// Anything else is rejected with a reason. Unknown forms are never submitted.
import { forbiddenEndpoint } from "./guard.js";

const L = (w) => String.raw`(?<![a-z])${w}(?![a-z])`; // whole-word helper that treats _ - [ ] as separators

// Where a negative word counts. "labels" = <label>/legend text and placeholders (long, chatty text);
// the other scopes are short, structural text that says what the form IS.
const SCOPES_ALL = [
  "buttons",
  "headings",
  "page",
  "attrs",
  "fields",
  "options",
  "labels",
];
const SCOPES_STRUCT = [
  "buttons",
  "headings",
  "page",
  "attrs",
  "fields",
  "options",
];
const SCOPES_FIELD = ["attrs", "fields", "options"];

export const NEGATIVES = [
  // user-generated content
  {
    kind: "comment",
    scopes: SCOPES_ALL,
    re: new RegExp(
      `${L("repl(?:y|ies|ying)")}|${L("bbp")}|${L("reviews?")}|${L("reviewer")}|${L("ratings?")}|${L("stars?")}|testimonial|guest-?book|${L("forum")}|${L("threads?")}|${L("answers?")}|${L("answering")}|${L("scores?")}|${L("scoring")}`,
      "i",
    ),
  },
  {
    kind: "comment",
    scopes: SCOPES_STRUCT,
    re: new RegExp(`${L("comments?")}|comment[-_]?post|wp-comments`, "i"),
  },
  {
    kind: "comment",
    scopes: ["buttons", "headings"],
    re: new RegExp(`${L("post")}|${L("share your")}|${L("leave a")}`, "i"),
  },
  // money
  {
    kind: "donation",
    scopes: SCOPES_ALL,
    re: new RegExp(`donat|pledge|${L("tips?")}|crowdfund|${L("gift")}`, "i"),
  },
  {
    kind: "donation",
    scopes: SCOPES_STRUCT,
    re: new RegExp(
      `${L("give")}|${L("giving")}|${L("support us")}|${L("sponsor")}`,
      "i",
    ),
  },
  {
    kind: "commerce",
    scopes: SCOPES_FIELD,
    re: new RegExp(
      `${L("amount")}|${L("price")}|${L("quantity")}|${L("qty")}|${L("total")}|${L("subtotal")}|${L("coupon")}|${L("promo")}|${L("variant")}|${L("sku")}`,
      "i",
    ),
  },
  {
    kind: "commerce",
    scopes: SCOPES_ALL,
    re: new RegExp(
      `${L("checkout")}|${L("payments?")}|${L("pay")}|${L("paying")}|${L("billing")}|${L("deposit")}|${L("invoice")}|card[-_ ]?(?:number|holder|element|details)|${L("cvv")}|${L("cvc")}|${L("iban")}|stripe|paypal|braintree|${L("add to (?:cart|basket|bag)")}|add-to-cart|${L("buy now")}`,
      "i",
    ),
  },
  {
    kind: "commerce",
    scopes: SCOPES_STRUCT,
    re: new RegExp(
      `${L("cart")}|${L("basket")}|${L("orders?")}|${L("purchase")}|${L("refunds?")}|${L("shipping")}|${L("subscription")}|${L("renew")}`,
      "i",
    ),
  },
  // account and data changes
  {
    kind: "account",
    scopes: SCOPES_ALL,
    re: new RegExp(
      `unsubscribe|${L("opt[-_ ]?out")}|${L("erase")}|${L("erasure")}|${L("delete")}|${L("deletion")}|${L("remove my")}|${L("gdpr")}|${L("ccpa")}|privacy[-_ ]?request|data[-_ ]?(?:subject[-_ ]?)?request|${L("passwords?")}|${L("passwd")}|${L("reset")}|${L("recover(?:y)?")}|${L("forgot")}|${L("registers?")}|${L("registration")}|sign[-_ ]?up|${L("signup")}|log[-_ ]?in|sign[-_ ]?in|${L("logout")}|${L("verify")}|${L("verification")}|${L("activate")}|${L("deactivate")}|${L("cancel(?:lation|led)?")}|report (?:this|a|the) (?:listing|ad|post|user|abuse|content)|${L("abuse")}`,
      "i",
    ),
  },
  {
    kind: "account",
    scopes: SCOPES_STRUCT,
    re: new RegExp(
      `${L("account")}|${L("profile")}|${L("membership")}|${L("member")}`,
      "i",
    ),
  },
  // events, jobs
  {
    kind: "event",
    scopes: SCOPES_ALL,
    re: new RegExp(
      `${L("rsvp")}|wait[-_ ]?list|${L("webinars?")}|${L("tickets?")}|${L("attend(?:ing)?")}|${L("workshop")}|${L("seats?")}`,
      "i",
    ),
  },
  {
    kind: "job",
    scopes: SCOPES_STRUCT,
    re: new RegExp(
      `${L("apply")}|${L("applications?")}|${L("applicant")}|${L("careers?")}|${L("resume")}|${L("cv")}|${L("jobs?")}|${L("vacanc(?:y|ies)")}|${L("hiring")}|${L("cover[-_ ]?letter")}`,
      "i",
    ),
  },
  { kind: 'comment', scopes: ['buttons', 'headings', 'attrs', 'fields'], re: new RegExp(`${L('topics?')}`, 'i') },
  { kind: 'comment', scopes: ['buttons', 'headings', 'labels'], re: /(?:^|\| ?)\s*re\s*:\s/i },
];

// Positive wording: what an enquiry looks like (English plus es/fr/de/pt/ur basics).
const MESSAGE_FIELD =
  /message|enquir|inquir|details|question|how can|help you|tell us|your needs|your request|project|notes?\b|body|write (?:to )?us|comments? or|mensaje|consulta|pregunta|nachricht|anfrage|frage|mensagem|dúvida|پیغام|سوال/i;
const CONTACT_WORDS = new RegExp(
  [
    "contact",
    "enquir",
    "inquir",
    "support",
    "how can we help",
    "ask (?:us|a question)",
    "request (?:a |an )?(?:booking|appointment|callback|call|quote|demo|info|information)",
    "booking request",
    "get a (?:free )?quote",
    "free quote",
    "request a (?:free )?quote",
    "quote",
    "callback",
    "call back",
    "request a call",
    "send (?:a |your |us a )?message",
    "book (?:a |your )?(?:free )?(?:consult|call|demo|meeting|appointment)",
    "consultation",
    "get in touch",
    "talk to (?:us|an? )",
    "reach (?:out|us)",
    "write to us",
    "speak to",
    "free estimate",
    "get started",
    "contacto",
    "cont[aá]ctanos",
    "presupuesto",
    "enviar mensaje",
    "consulta",
    "p[oó]ngase en contacto",
    "contactez",
    "nous contacter",
    "devis",
    "envoyer le message",
    "prendre contact",
    "kontakt",
    "anfrage",
    "nachricht senden",
    "angebot",
    "kontaktieren",
    "contato",
    "or[cç]amento",
    "enviar mensagem",
    "fale conosco",
    "entre em contato",
    "rabta",
    "raabta",
    "رابطہ",
    "پیغام",
    "ہم سے",
  ].join("|"),
  "i",
);

const norm = (s) => String(s || "").toLowerCase();
const pathWords = (url) => {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname).replace(/[/_.-]+/g, " ");
  } catch {
    return "";
  }
};

/** Collect the text a person would read, split by scope. */
export function evidenceFor(form) {
  const fields = form.fields || [];
  const attrs = [
    form.id,
    form.name,
    form.className,
    pathWords(form.actionAbs),
    ...(form.submitActions || []).map((x) => pathWords(x.action || "")),
  ]
    .filter(Boolean)
    .join(" ");
  const labelTexts = [
    ...(form.labelTexts || []),
    ...fields.flatMap((f) => [f.label, f.placeholder]),
  ]
    .filter(Boolean)
    .join(" | ");
  return {
    buttons: [...(form.submitTexts || []), form.submit?.text]
      .filter(Boolean)
      .join(" | "),
    headings: [form.heading, form.pageH1].filter(Boolean).join(" | "),
    page: `${pathWords(form.firstPage)} ${form.pageTitle || ""}`.trim(),
    attrs,
    fields: fields
      .map((f) => `${f.name || ""} ${f.id || ""}`)
      .join(" | ")
      .replace(/[[\]]/g, " "),
    options: fields
      .flatMap((f) => (f.options || []).map((o) => `${o.text} ${o.value}`))
      .join(" | "),
    labels: labelTexts,
  };
}

// Number inputs that are fine in a contact form (and the only ones ever filled). Any other number/range input
// is a quantity, amount, count or score of unknown purpose, so the form is rejected and nothing is typed in it.
export const SAFE_NUMBER =
  /phone|mobile|tel\b|zip|postal|post-?code|(?<![a-z])code(?![a-z])|(?<![a-z])ext(?:ension)?(?![a-z])|(?<![a-z])age(?![a-z])|year|staff|employee|people|guests?|rooms?|floors?|storey|sq(?:uare)?[-_ ]?(?:ft|m|feet|metres|meters)|(?<![a-z])area(?![a-z])|bedrooms?|bathrooms?|number of|how many|(?<![a-z])units?(?![a-z])/i;

const CURRENCY =
  /[$€£¥₹₨₦₱฿]\s?\d|\d[\d,.]*\s?[$€£¥₹₨]|(?<![a-z])(?:usd|eur|gbp|pkr|inr|aud|cad|chf)(?![a-z])\s?\d|\d\s?(?:usd|eur|gbp|pkr|dollars?|euros?|pounds?|rupees?)(?![a-z])/i;
const YES_NO =
  /^(?:yes|no|maybe|attending|not attending|attend|going|not going|i'?m going|i am going|count me in|can'?t make it|cannot attend|decline|accept|joyfully accept|regretfully decline|yes,? i'?ll be there|no,? i can'?t)[.!]?$/i;
const HIDDEN_PAYMENT =
  /(?<![a-z])(?:pan|exp|expiry|expiration|sec|cvc|cvv|card|ccnum|iban|account|routing)(?![a-z])/i;
const VENDOR_INTENT =
  /wpcf7|gform|wpforms|elementor-form|hs-form|hsform|hbspt|form-builder|ninja-forms|nf-form|frm_forms|fluentform|forminator|contact[-_ ]?form|jetpack-contact|et_pb_contact|(?<![a-z])contact(?![a-z])/i;

/** Option texts / radio labels that mean "attending", "yes/no" and the like. */
function yesNoOption(form) {
  for (const f of form.fields || []) {
    if (f.tag === "select") {
      for (const o of f.options || [])
        if (
          YES_NO.test(String(o.text).trim()) ||
          YES_NO.test(String(o.value).trim())
        )
          return `option "${o.text || o.value}" in select "${f.name || f.id}"`;
    }
    if (f.type === "radio") {
      const t = `${f.label || ""}`.trim();
      if (YES_NO.test(t) || YES_NO.test(String(f.value || "").trim()))
        return `radio "${t || f.value}"`;
    }
  }
  return null;
}

/**
 * Strict allow-list: AND of
 *   1. contact intent in heading / button / label / legend / form markup (contact vocabulary), and
 *   2. a message / details field (or, for recognised form-builder markup, name + email + phone), and
 *   3. an email or phone field to reply to,
 * and NO negative signal anywhere a person reads.
 * @returns {{verdict:'lead'|'newsletter'|'reject', kind:string, reasons:string[], positives:string[]}}
 */
export function assessForm(form) {
  const f = form.fields || [];
  const reject = (kind, ...reasons) => ({
    verdict: "reject",
    kind,
    reasons,
    positives: [],
  });

  // Hard structural facts first.
  if (f.some((x) => x.type === "password"))
    return reject("login", "password field: login, registration or reset form");
  if (f.some((x) => x.type === "file"))
    return reject("file-upload", "file upload field");
  if (form.paymentEmbed)
    return reject(
      "commerce",
      "payment widget (Stripe, PayPal, Braintree, Square or a card element) inside the form",
    );
  // Multi-step forms: step 2 is not on this page, so the tool cannot judge what it would send.
  const hiddenPay = f.find(
    (x) =>
      !x.visible &&
      x.type !== "submit" &&
      HIDDEN_PAYMENT.test(`${x.name} ${x.id} ${x.autocomplete}`),
  );
  if (hiddenPay)
    return reject(
      "multi-step",
      "multi-step form (step 2 looks like payment): test manually",
    );
  if ((form.stepControls || []).length)
    return reject(
      "multi-step",
      `multi-step form (a "${form.stepControls[0]}" step): test manually`,
    );
  for (const url of [
    form.actionAbs,
    ...(form.submitActions || []).map((x) => x.action),
  ]) {
    if (!url) continue;
    const hit = forbiddenEndpoint(url);
    if (hit && hit.kind !== "robots")
      return reject(hit.kind, `forbidden endpoint ${hit.path} (${hit.why})`);
  }
  if (
    f.some(
      (x) =>
        /^cc-/i.test(x.autocomplete || "") ||
        /card[-_ ]?(?:number|holder)|cvv|cvc/i.test(`${x.name} ${x.id}`),
    )
  )
    return reject("commerce", "card fields");

  // Negative signals in every place a human would read.
  const ev = evidenceFor(form);
  const negatives = [];
  for (const rule of NEGATIVES) {
    for (const scope of rule.scopes) {
      const m = ev[scope] && ev[scope].match(rule.re);
      if (m)
        negatives.push({
          kind: rule.kind,
          text: `"${m[0].trim()}" in ${scope}`,
        });
    }
  }
  // Currency symbols and amounts anywhere people read them (labels, options, placeholders, buttons, headings).
  for (const scope of ["labels", "options", "buttons", "headings"]) {
    const m = ev[scope] && ev[scope].match(CURRENCY);
    if (m)
      negatives.push({
        kind: "donation",
        text: `amount "${m[0].trim()}" in ${scope}`,
      });
  }
  const yn = yesNoOption(form);
  if (yn)
    negatives.push({
      kind: "event",
      text: `yes/no or attending answer (${yn})`,
    });
  // Number and range inputs of unknown purpose: amounts, counts, scores. Never filled, never submitted.
  const oddNumber = f.find(
    (x) =>
      x.visible &&
      (x.type === "number" || x.type === "range") &&
      !SAFE_NUMBER.test(`${x.name} ${x.id} ${x.label} ${x.placeholder}`),
  );
  if (oddNumber)
    negatives.push({
      kind: "commerce",
      text: `number field "${oddNumber.name || oddNumber.id || oddNumber.type}" of unknown purpose`,
    });
  if (negatives.length)
    return reject(
      negatives[0].kind,
      ...negatives.slice(0, 3).map((n) => `negative signal ${n.text}`),
    );

  const visible = f.filter(
    (x) =>
      x.visible &&
      !x.honeypot &&
      ![
        "submit",
        "button",
        "hidden",
        "image",
        "reset",
        "checkbox",
        "radio",
      ].includes(x.type),
  );
  const hasEmail = f.some(
    (x) =>
      x.visible &&
      !x.honeypot &&
      (x.type === "email" || /e-?mail/i.test(`${x.name} ${x.id}`)),
  );
  const hasTel = f.some(
    (x) =>
      x.visible &&
      !x.honeypot &&
      (x.type === "tel" ||
        /phone|mobile|whatsapp|tel\b/i.test(`${x.name} ${x.id}`)),
  );
  const hasName = f.some(
    (x) =>
      x.visible &&
      !x.honeypot &&
      /name/i.test(`${x.name} ${x.id} ${x.label} ${x.placeholder}`),
  );
  const textareas = f.filter((x) => x.visible && x.tag === "textarea");
  const role = norm(form.role);

  if (
    role === "search" ||
    (visible.length === 1 &&
      (visible[0].type === "search" ||
        /^(s|q|query|search|keyword|keywords)$/i.test(visible[0].name || "")))
  ) {
    return reject("search", "search form");
  }
  const hasReply = hasEmail || hasTel;

  // Email-only: a newsletter (never submitted by default).
  if (!textareas.length && hasEmail && visible.length <= 2) {
    return {
      verdict: "newsletter",
      kind: "newsletter",
      reasons: ["email-only form: looks like a newsletter sign-up"],
      positives: [],
    };
  }
  if (!hasReply)
    return reject("other", "no email or phone field: no way to reply");

  // The AND.
  const positives = [];
  const intentText = [ev.buttons, ev.headings, ev.labels].find((t) =>
    CONTACT_WORDS.test(t),
  );
  const vendor = VENDOR_INTENT.test(ev.attrs);
  const intent =
    intentText !== undefined
      ? `contact wording "${(intentText.match(CONTACT_WORDS) || [""])[0]}"`
      : vendor
        ? "contact-form markup"
        : null;
  const msgField = textareas.find((x) =>
    MESSAGE_FIELD.test(`${x.name} ${x.id} ${x.label} ${x.placeholder}`),
  );
  const trio = hasName && hasEmail && hasTel && vendor;
  if (!intent)
    return reject(
      "other",
      "no contact intent: no contact wording in the heading, button or labels near the form",
    );
  if (!msgField && !trio) return reject("other", "no message or details field");
  positives.push(intent);
  positives.push(
    msgField
      ? `message field "${msgField.name || msgField.id}"`
      : "name + email + phone in contact-form markup",
  );
  return { verdict: "lead", kind: "contact", reasons: [], positives };
}
