// Runs INSIDE the page (page.evaluate). Must be fully self-contained: no imports, no closures.
// Read-only: it never clicks, types or submits.

export function extractPage(opts) {
  const chatMap = (opts && opts.chatSelectors) || {};
  const ctaRe =
    /contact|book|call|get (?:a )?(?:quote|started|in touch)|quote|schedule|appointment|consult|whatsapp|message us|enquir|inquir|free|demo|start|talk to|reach|email us|request/i;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y + window.scrollY),
      w: Math.round(r.width),
      h: Math.round(r.height),
      top: Math.round(r.top),
    };
  };
  const isVisible = (el) => {
    const cs = getComputedStyle(el);
    if (
      cs.display === "none" ||
      cs.visibility === "hidden" ||
      cs.opacity === "0"
    )
      return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const isOffscreen = (el) => {
    const r = el.getBoundingClientRect();
    return (
      r.right < 0 ||
      r.bottom < 0 ||
      r.left > vw + 2000 ||
      r.width <= 1 ||
      r.height <= 1
    );
  };
  const labelFor = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    if (el.id) {
      const l = document.querySelector(
        'label[for="' + CSS.escape(el.id) + '"]',
      );
      if (l) return l.textContent.trim().slice(0, 80);
    }
    const wrap = el.closest("label");
    if (wrap) return wrap.textContent.trim().slice(0, 80);
    return "";
  };

  const forms = Array.from(document.querySelectorAll("form")).map(
    (form, formIndex) => {
      // form.elements includes controls associated through form="id" that sit outside the <form> tag.
      const controls = Array.from(form.elements).filter((e) =>
        /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName),
      );
      const fields = controls.map((el, i) => {
        const tag = el.tagName.toLowerCase();
        const type =
          tag === "input"
            ? (el.getAttribute("type") || "text").toLowerCase()
            : tag;
        const cs = getComputedStyle(el);
        return {
          i,
          tag,
          type,
          name: el.getAttribute("name") || "",
          id: el.id || "",
          placeholder: el.getAttribute("placeholder") || "",
          label: labelFor(el),
          required: el.required || el.getAttribute("aria-required") === "true",
          visible: isVisible(el) && !isOffscreen(el),
          displayNone: cs.display === "none" || cs.visibility === "hidden",
          offscreen: isOffscreen(el),
          ariaHidden: el.getAttribute("aria-hidden") === "true",
          tabindexNegative: el.getAttribute("tabindex") === "-1",
          autocomplete: el.getAttribute("autocomplete") || "",
          value: /^(radio|checkbox)$/.test(type) ? el.value || "" : "",
          min: el.getAttribute("min") || "",
          max: el.getAttribute("max") || "",
          multiple: !!el.multiple,
          options:
            tag === "select"
              ? Array.from(el.options)
                  .slice(0, 40)
                  .map((o) => ({
                    value: o.value,
                    text: o.text.trim().slice(0, 40),
                    disabled: o.disabled,
                  }))
              : undefined,
        };
      });
      const submitEl = form.querySelector(
        'button[type="submit"], input[type="submit"], button:not([type]), button:not([type="button"]):not([type="reset"])',
      );
      let submit = null;
      if (submitEl) {
        const r = submitEl.getBoundingClientRect();
        const visible = isVisible(submitEl);
        let covered = false;
        if (visible && r.width > 0) {
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          if (cy >= 0 && cy <= window.innerHeight && cx >= 0 && cx <= vw) {
            const top = document.elementFromPoint(cx, cy);
            covered = !!top && top !== submitEl && !submitEl.contains(top);
          }
        }
        submit = {
          text: (submitEl.value || submitEl.textContent || "")
            .trim()
            .slice(0, 60),
          w: Math.round(r.width),
          h: Math.round(r.height),
          visible,
          covered,
          disabled: !!submitEl.disabled,
        };
      }
      const markup = [];
      form
        .querySelectorAll(
          '.g-recaptcha, [data-sitekey], .h-captcha, .cf-turnstile, iframe, textarea[name="g-recaptcha-response"], input[name="cf-turnstile-response"], input[name="h-captcha-response"]',
        )
        .forEach((n) => {
          markup.push(
            (n.className && String(n.className)) +
              " " +
              (n.getAttribute("src") || "") +
              " " +
              (n.getAttribute("name") || "") +
              " " +
              (n.getAttribute("data-sitekey") ? "sitekey" : ""),
          );
        });
      return {
        formIndex,
        id: form.id || "",
        className: String(form.className || "").slice(0, 200),
        name: form.getAttribute("name") || "",
        role: form.getAttribute("role") || "",
        method: (form.getAttribute("method") || "get").toLowerCase(),
        actionAttr: form.getAttribute("action"),
        actionAbs:
          form.getAttribute("action") === null
            ? location.href
            : (function () {
                try {
                  return new URL(form.getAttribute("action"), location.href)
                    .href;
                } catch (e) {
                  return "";
                }
              })(),
        hasOnsubmit: !!form.getAttribute("onsubmit"),
        // Every control that can submit this form, with its own formaction/formmethod override.
        submitActions: Array.from(form.elements)
          .filter((e) => {
            const t = (e.getAttribute("type") || "").toLowerCase();
            return (
              (e.tagName === "BUTTON" && t !== "button" && t !== "reset") ||
              (e.tagName === "INPUT" && (t === "submit" || t === "image"))
            );
          })
          .map((e) => {
            const fa = e.getAttribute("formaction");
            let abs = null;
            if (fa !== null) {
              try {
                abs = new URL(fa, location.href).href;
              } catch (err) {
                abs = "";
              }
            }
            return { action: abs, method: (e.getAttribute("formmethod") || "").toLowerCase() };
          }),
        visible: isVisible(form),
        fields,
        submit,
        captchaMarkup: markup,
        // Evidence for the allow-list classifier: what a human reads on and around the form.
        // Controls that move to a later step instead of submitting ("Next", "Continue"): multi-step forms.
        stepControls: Array.from(form.elements)
          .filter((e) => /^(BUTTON|INPUT)$/.test(e.tagName))
          .map((e) => ((e.tagName === "INPUT" ? e.value : e.textContent) || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "))
          .filter((t) => /^(next|continue|proceed|step\s*\d|siguiente|continuar|suivant|weiter|pr[oó]ximo)/i.test(t))
          .slice(0, 5),
        submitTexts: Array.from(form.elements)
          .filter((e) => /^(BUTTON|INPUT)$/.test(e.tagName) && !/^(button|reset|hidden|text|email|tel|number|checkbox|radio|file|password|date|url|search)$/i.test(e.getAttribute("type") || (e.tagName === "BUTTON" ? "submit" : "")))
          .map((e) => ((e.value && e.tagName === "INPUT" ? e.value : e.textContent) || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 80))
          .filter(Boolean),
        labelTexts: Array.from(form.querySelectorAll("label, legend"))
          .map((l) => (l.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100))
          .filter(Boolean)
          .slice(0, 40),
        heading: (function () {
          const own = form.querySelector("legend, h1, h2, h3, h4, h5");
          if (own) return own.textContent.trim().replace(/\s+/g, " ").slice(0, 120);
          const aria = form.getAttribute("aria-label") || form.getAttribute("title");
          if (aria) return aria.slice(0, 120);
          let node = form;
          for (let up = 0; up < 5 && node && node !== document.body; up++, node = node.parentElement) {
            let sib = node.previousElementSibling;
            for (let k = 0; k < 4 && sib; k++, sib = sib.previousElementSibling) {
              if (/^H[1-6]$/.test(sib.tagName)) return sib.textContent.trim().replace(/\s+/g, " ").slice(0, 120);
              const h = sib.querySelector && sib.querySelector("h1, h2, h3, h4, h5, h6");
              if (h) return h.textContent.trim().replace(/\s+/g, " ").slice(0, 120);
            }
          }
          return "";
        })(),
        paymentEmbed: !!form.querySelector(
          '#card-element, .StripeElement, [data-stripe], .paypal-button, [id*="paypal" i], [class*="braintree" i], [id*="sq-card" i], iframe[src*="js.stripe.com"], iframe[src*="paypal."], iframe[src*="braintree"], iframe[src*="squareup"], iframe[src*="checkout."]',
        ),
        rect: rectOf(form),
      };
    },
  );

  const anchors = Array.from(document.querySelectorAll("a[href]"))
    .slice(0, 1500)
    .map((a) => {
      const r = a.getBoundingClientRect();
      return {
        raw: a.getAttribute("href"),
        href: a.href,
        text: (a.textContent || a.getAttribute("aria-label") || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 80),
        visible: isVisible(a),
        top: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    });

  const scripts = Array.from(document.querySelectorAll("script[src]")).map(
    (s) => s.src,
  );
  const iframes = Array.from(document.querySelectorAll("iframe[src]")).map(
    (f) => f.src,
  );
  let inline = "";
  document.querySelectorAll("script:not([src])").forEach((s) => {
    if (inline.length < 200000)
      inline += " " + (s.textContent || "").slice(0, 20000);
  });
  let resources = [];
  try {
    resources = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .slice(0, 600);
  } catch (e) {
    /* ignore */
  }

  const chatRendered = {};
  Object.keys(chatMap).forEach((vendor) => {
    chatRendered[vendor] = chatMap[vendor].some((sel) => {
      try {
        return Array.from(document.querySelectorAll(sel)).some((el) => {
          const r = el.getBoundingClientRect();
          return (r.width > 0 && r.height > 0) || el.tagName === "IFRAME";
        });
      } catch (e) {
        return false;
      }
    });
  });

  // Mobile signals: is there a contact call-to-action in the first screen?
  const ctaCandidates = [];
  document
    .querySelectorAll('a[href], button, input[type="submit"]')
    .forEach((el) => {
      if (!isVisible(el)) return;
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.top > vh) return;
      const text = (
        (el.value || el.textContent || el.getAttribute("aria-label") || "") + ""
      )
        .trim()
        .replace(/\s+/g, " ");
      const href = el.getAttribute("href") || "";
      const isDirect =
        /^(tel:|mailto:|sms:)/i.test(href) ||
        /wa\.me|whatsapp/i.test(href) ||
        /calendly\.com|cal\.com|acuity/i.test(href);
      if (isDirect || (text && text.length < 60 && ctaRe.test(text)))
        ctaCandidates.push({
          text: text.slice(0, 50),
          href: href.slice(0, 80),
          top: Math.round(r.top),
        });
    });
  const inFirstScreenForm = forms.some(
    (f) => f.visible && f.rect.top >= 0 && f.rect.top < vh,
  );

  return {
    url: location.href,
    title: document.title,
    h1: (document.querySelector("h1") || {}).textContent
      ? document.querySelector("h1").textContent.trim().slice(0, 120)
      : "",
    viewport: { w: vw, h: vh },
    horizontalOverflow: document.documentElement.scrollWidth > vw + 4,
    forms,
    anchors,
    scripts,
    iframes,
    inline,
    resources,
    chatRendered,
    cta: {
      aboveFold: ctaCandidates.length > 0 || inFirstScreenForm,
      candidates: ctaCandidates.slice(0, 5),
      formInFirstScreen: inFirstScreenForm,
    },
    textSample: (document.body ? document.body.innerText : "").slice(0, 4000),
  };
}
