// Turns per-page raw extractions into a deduplicated lead inventory.
import { assessForm } from "./classify.js";
import {
  analyzeTel,
  analyzeMailto,
  analyzeWhatsApp,
  isWhatsAppHref,
  bookingVendor,
  detectChatVendors,
  detectCaptcha,
  isHoneypotField,
  classifyForm,
  formSignature,
} from "./rules.js";

function addPage(map, key, make, page) {
  let e = map.get(key);
  if (!e) {
    e = make();
    e.pages = [];
    map.set(key, e);
  }
  if (!e.pages.includes(page)) e.pages.push(page);
  return e;
}

/** Classify a console message as 'exception' | 'console' | 'resource'. */
export function classifyConsole(msg) {
  if (msg.kind === "pageerror") return "exception";
  if (
    /failed to load resource|net::err_|status of 4\d\d|status of 5\d\d/i.test(
      msg.text,
    )
  )
    return "resource";
  return "console";
}

/**
 * @param {Array} pages [{url,status,extract,consoleMessages:[{kind,text}],failedRequests:[{url,status}]}]
 */
export function buildInventory(pages, { ownHost = null } = {}) {
  const forms = new Map();
  const mailto = new Map();
  const tel = new Map();
  const whatsapp = new Map();
  const booking = new Map();
  const chat = new Map();
  const pageSummaries = [];

  for (const p of pages) {
    const x = p.extract;
    const summary = {
      url: p.url,
      status: p.status,
      title: x?.title || "",
      cta: x?.cta || null,
      horizontalOverflow: !!x?.horizontalOverflow,
      forms: x?.forms?.length || 0,
      consoleErrors: 0,
      exceptions: 0,
      error: p.error || null,
    };
    pageSummaries.push(summary);
    if (!x) continue;

    const errs = (p.consoleMessages || []).filter(
      (m) => m.kind === "pageerror" || m.type === "error",
    );
    summary.exceptions = errs.filter(
      (m) => classifyConsole(m) === "exception",
    ).length;
    summary.consoleErrors = errs.length;

    for (const f of x.forms) {
      const fields = f.fields.map((fl) => ({
        ...fl,
        honeypot: isHoneypotField(fl),
      }));
      const captcha = detectCaptcha({
        formMarkup: f.captchaMarkup,
        pageScripts: [...x.scripts, ...x.iframes, ...(x.resources || [])],
      });
      const shaped = { ...f, fields, firstPage: p.url, pageTitle: x.title || '', pageH1: x.h1 || '' };
      const assessment = assessForm(shaped);
      const kind = assessment.kind;
      const sig = formSignature(shaped);
      const e = addPage(
        forms,
        sig,
        () => ({
          sig,
          kind,
          method: f.method,
          id: f.id,
          name: f.name,
          className: f.className,
          assessment,
          submitTexts: f.submitTexts || [],
          heading: f.heading || '',
          labelTexts: f.labelTexts || [],
          paymentEmbed: !!f.paymentEmbed,
          pageTitle: x.title || '',
          pageH1: x.h1 || '',
          actionAttr: f.actionAttr,
          actionAbs: f.actionAbs,
          hasOnsubmit: f.hasOnsubmit,
          submitActions: f.submitActions || [],
          fields,
          submit: f.submit,
          captcha,
          firstPage: p.url,
          formIndex: f.formIndex,
          visibleOnMobile: f.visible,
          required: fields.filter(
            (fl) => fl.required && fl.visible && !fl.honeypot,
          ).length,
          honeypots: fields
            .filter((fl) => fl.honeypot)
            .map((fl) => fl.name || fl.id),
          jsErrors: [],
          networkErrors: [],
        }),
        p.url,
      );
      // Attach page-level errors once per (form, page).
      for (const m of errs) {
        const cls = classifyConsole(m);
        if (!e.jsErrors.some((j) => j.page === p.url && j.text === m.text))
          e.jsErrors.push({
            page: p.url,
            class: cls,
            text: m.text.slice(0, 200),
          });
      }
    }

    for (const a of x.anchors) {
      const href = a.href || a.raw || "";
      if (/^mailto:/i.test(href)) {
        addPage(
          mailto,
          href.toLowerCase(),
          () => ({ href, text: a.text, analysis: analyzeMailto(href) }),
          p.url,
        );
      } else if (/^tel:/i.test(href)) {
        addPage(
          tel,
          href.replace(/\s/g, ""),
          () => ({ href, text: a.text, analysis: analyzeTel(href) }),
          p.url,
        );
      } else if (isWhatsAppHref(href)) {
        addPage(
          whatsapp,
          href,
          () => ({ href, text: a.text, analysis: analyzeWhatsApp(href) }),
          p.url,
        );
      } else if (/^https?:/i.test(href)) {
        const vendor = bookingVendor(href, { ownHost });
        if (vendor)
          addPage(
            booking,
            href.split("#")[0],
            () => ({ href, text: a.text, vendor }),
            p.url,
          );
      }
    }
    for (const f of x.iframes) {
      const vendor = bookingVendor(f, { ownHost });
      if (vendor)
        addPage(
          booking,
          f,
          () => ({ href: f, text: "(embedded)", vendor, embedded: true }),
          p.url,
        );
    }

    const urls = [...x.scripts, ...x.iframes, ...(x.resources || [])];
    for (const v of detectChatVendors(urls, x.inline)) {
      const e = addPage(
        chat,
        v.vendor,
        () => ({
          vendor: v.vendor,
          evidence: v.evidence,
          renderedOn: [],
          missingOn: [],
          requestFailures: [],
        }),
        p.url,
      );
      if (x.chatRendered?.[v.vendor]) e.renderedOn.push(p.url);
      else e.missingOn.push(p.url);
      for (const rf of p.failedRequests || []) {
        if (
          v.srcPatterns.some((re) => re.test(rf.url)) &&
          !e.requestFailures.some((r) => r.url === rf.url)
        )
          e.requestFailures.push(rf);
      }
    }
  }

  const chatList = [...chat.values()].map((c) => ({
    ...c,
    rendered: c.renderedOn.length > 0,
  }));
  return {
    pages: pageSummaries,
    forms: [...forms.values()],
    mailto: [...mailto.values()],
    tel: [...tel.values()],
    whatsapp: [...whatsapp.values()],
    booking: [...booking.values()],
    chat: chatList,
  };
}

export function leadPathCount(inv) {
  return (
    inv.forms.filter((f) => f.kind === "contact" || f.kind === "newsletter")
      .length +
    inv.mailto.length +
    inv.tel.length +
    inv.whatsapp.length +
    inv.booking.length +
    inv.chat.length
  );
}
