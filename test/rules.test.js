import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeTel,
  analyzeMailto,
  analyzeWhatsApp,
  isWhatsAppHref,
  detectChatVendors,
  detectCaptcha,
  isHoneypotField,
  classifyForm,
  bookingVendor,
} from "../src/rules.js";
import { parseRobots } from "../src/net.js";

test("tel: E.164, local, placeholder and garbage", () => {
  assert.equal(analyzeTel("tel:+14155552671").e164, true);
  assert.equal(analyzeTel("tel:+1 (415) 555-2671").e164, true);
  const local = analyzeTel("tel:0800 123 456");
  assert.equal(local.valid, true);
  assert.equal(local.issue, "not-international");
  assert.equal(analyzeTel("tel:call-us-now").issue, "invalid-characters");
  assert.equal(analyzeTel("tel:1234567890").issue, "placeholder");
  assert.equal(analyzeTel("tel:+1 555 0100").issue, "placeholder");
  assert.equal(analyzeTel("tel:123").issue, "bad-length");
  assert.equal(analyzeTel("tel:").issue, "empty");
});

test("mailto: format, placeholder domains, query strings", () => {
  assert.equal(analyzeMailto("mailto:hello@acme.co.uk?subject=Hi").valid, true);
  assert.equal(analyzeMailto("mailto:hello@acme.co.uk").domain, "acme.co.uk");
  assert.equal(analyzeMailto("mailto:you@example.com").issue, "placeholder");
  assert.equal(analyzeMailto("mailto:not-an-address").issue, "invalid-format");
  assert.equal(analyzeMailto("mailto:").issue, "empty");
});

test("WhatsApp: number format, prefill, short links", () => {
  const ok = analyzeWhatsApp("https://wa.me/14155552671?text=Hello");
  assert.equal(ok.valid, true);
  assert.equal(ok.prefilled, true);
  assert.equal(analyzeWhatsApp("https://wa.me/14155552671").prefilled, false);
  assert.equal(analyzeWhatsApp("https://wa.me/+0123abc").issue, "non-numeric");
  assert.equal(
    analyzeWhatsApp("https://wa.me/0044123456789").issue,
    "leading-zero",
  );
  assert.equal(analyzeWhatsApp("https://wa.me/12345").issue, "bad-length");
  assert.equal(
    analyzeWhatsApp("https://wa.me/+14155552671").issue,
    "plus-sign",
  );
  assert.equal(analyzeWhatsApp("https://wa.me/").issue, "missing-number");
  assert.equal(
    analyzeWhatsApp("https://api.whatsapp.com/send?phone=14155552671&text=Hi")
      .valid,
    true,
  );
  assert.equal(
    analyzeWhatsApp("https://api.whatsapp.com/send").issue,
    "missing-number",
  );
  assert.equal(
    analyzeWhatsApp("https://wa.me/message/ABC123").kind,
    "short-link",
  );
  assert.equal(isWhatsAppHref("https://wa.me/1"), true);
  assert.equal(isWhatsAppHref("https://example.com/wa.me"), false);
});

test("chat vendors are detected by script signature", () => {
  const urls = [
    "https://embed.tawk.to/x/default",
    "https://widget.intercom.io/widget/abc",
    "https://code.tidio.co/k.js",
    "/local/app.js",
  ];
  const names = detectChatVendors(urls, "")
    .map((v) => v.vendor)
    .sort();
  assert.deepEqual(names, ["Intercom", "Tawk.to", "Tidio"]);
  assert.deepEqual(
    detectChatVendors([], 'window.$crisp=[];CRISP_WEBSITE_ID="x"').map(
      (v) => v.vendor,
    ),
    ["Crisp"],
  );
  assert.deepEqual(
    detectChatVendors(["https://widgets.leadconnectorhq.com/loader.js"]).map(
      (v) => v.vendor,
    ),
    ["GoHighLevel / LeadConnector"],
  );
  assert.equal(detectChatVendors(["/app.js"]).length, 0);
});

test("booking vendors", () => {
  assert.equal(bookingVendor("https://calendly.com/a/b"), "Calendly");
  assert.equal(bookingVendor("https://cal.com/a/b"), "Cal.com");
  assert.equal(bookingVendor("https://acme.as.me/schedule"), "Acuity");
  assert.equal(bookingVendor("https://example.com/calendly.com"), null);
});

test("CAPTCHA detection: form markup first, page scripts second", () => {
  assert.deepEqual(detectCaptcha({ formMarkup: ["g-recaptcha sitekey"] }), {
    present: true,
    kind: "reCAPTCHA",
    scope: "form",
  });
  assert.equal(
    detectCaptcha({ formMarkup: ["cf-turnstile"] }).kind,
    "Cloudflare Turnstile",
  );
  assert.equal(detectCaptcha({ formMarkup: ["h-captcha"] }).kind, "hCaptcha");
  assert.deepEqual(
    detectCaptcha({
      pageScripts: ["https://www.google.com/recaptcha/api.js?render=abc"],
    }),
    { present: true, kind: "reCAPTCHA", scope: "page" },
  );
  assert.equal(detectCaptcha({ pageScripts: ["/app.js"] }).present, false);
});

test("honeypot: invisible text fields only", () => {
  assert.equal(
    isHoneypotField({
      type: "text",
      name: "website_url",
      visible: false,
      offscreen: true,
    }),
    true,
  );
  assert.equal(
    isHoneypotField({
      type: "text",
      name: "x",
      visible: false,
      tabindexNegative: true,
    }),
    true,
  );
  assert.equal(
    isHoneypotField({ type: "text", name: "website_url", visible: true }),
    false,
  );
  assert.equal(
    isHoneypotField({ type: "hidden", name: "csrf", visible: false }),
    false,
  );
});

test("form kinds", () => {
  const f = (fields, role) => ({
    role,
    fields: fields.map((x) => ({ visible: true, tag: "input", ...x })),
  });
  assert.equal(
    classifyForm(f([{ type: "password" }, { type: "text" }])),
    "login",
  );
  assert.equal(classifyForm(f([{ type: "search", name: "q" }])), "search");
  assert.equal(
    classifyForm(f([{ type: "email", name: "email" }])),
    "newsletter",
  );
  assert.equal(
    classifyForm(
      f([
        { type: "text", name: "n" },
        { type: "email", name: "email" },
        { tag: "textarea", type: "textarea", name: "m" },
      ]),
    ),
    "contact",
  );
});

test("robots.txt: wildcard group, longest match, allow override", () => {
  const r = parseRobots(
    "User-agent: *\nDisallow: /private/\nDisallow: /*.pdf$\nAllow: /private/public\n",
  );
  assert.equal(r.isAllowed("/contact"), true);
  assert.equal(r.isAllowed("/private/x"), false);
  assert.equal(r.isAllowed("/private/public/x"), true);
  assert.equal(r.isAllowed("/a/file.pdf"), false);
  assert.equal(
    parseRobots("User-agent: lead-leak-audit\nDisallow: /\n").isAllowed("/x"),
    false,
  );
  assert.equal(parseRobots("").isAllowed("/x"), true);
});
