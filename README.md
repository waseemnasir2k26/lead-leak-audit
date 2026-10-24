# lead-leak-audit: find where your website's leads die

![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![Node 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)
![Playwright](https://img.shields.io/badge/browser-Playwright-blue.svg)

**You pay for traffic while the contact form returns a 404, the WhatsApp button points to a dead number and the chat bubble never loads.**

A free, local Node CLI that audits your own site's lead path and writes a shareable HTML + JSON report with a 0-100 lead survival score. Nothing is uploaded anywhere.

![npm run demo](docs/demo.gif)

![Sample report](docs/sample-report.png)

Open the full [sample report](examples/sample-report.html) (generated from the fixture site in `examples/demo-site`, which is broken on purpose). A [full-page PNG](docs/sample-report-full.png) and a [phone-width PNG](docs/sample-report-mobile.png) are in `docs/`.

Zero install (needs Node 20+ and a one-time `npx playwright install chromium`):

```bash
npx github:waseemnasir2k26/lead-leak-audit scan https://your-site.example
```

## What it will never submit

`scan` is read-only. `submit` is an **allow-list**: a form is submitted only when it shows positive signals of being an enquiry form, and never when any negative signal appears in what a person would read (button text, labels, headings, select options, field names, form attributes, page URL and title).

- **Positive (all needed):** a message / enquiry / details box, or contact wording on the button, heading, URL or form (contact, enquire, get a quote, request a callback, send message, book a consultation, get in touch, plus Spanish, French, German, Portuguese and Urdu basics), or a name + email + phone trio; **and** an email or phone field to reply to.
- **Negative (any one rejects):** reply, comment, review, rating, stars, testimonial, guestbook, forum, post, donate, give, pledge, amount, price, quantity, refund, cancel, unsubscribe, erase, delete, GDPR, report listing, password, reset, recover, register, sign up, RSVP, waitlist, webinar, checkout, payment, card, Stripe / PayPal / Braintree / Square elements, job applications, file uploads, login.
- An `amount`, `price` or `quantity` field means the form is never submitted, and the tool never fills one.
- Newsletter sign-ups (email-only forms) are skipped unless you pass `--include-newsletter`, because that subscribes your test inbox.
- Anything unknown is rejected. If a real contact form is skipped, `--dry-run` says why.

This is the real dry-run output for a set of look-alike forms (the test pages are named after the shape, so the page URL and title add to some of the reasons):

| Form shape | Verdict | Why (from the dry run) |
| --- | --- | --- |
| `cf7` | submitted | positive signals: message field or contact wording, plus email/phone |
| `gravity` | submitted | positive signals: message field or contact wording, plus email/phone |
| `wpforms` | submitted | positive signals: message field or contact wording, plus email/phone |
| `elementor` | submitted | positive signals: message field or contact wording, plus email/phone |
| `hubspot` | submitted | positive signals: message field or contact wording, plus email/phone |
| `shopifyContact` | submitted | positive signals: message field or contact wording, plus email/phone |
| `ghl` | submitted | positive signals: message field or contact wording, plus email/phone |
| `booking` | submitted | positive signals: message field or contact wording, plus email/phone |
| `hubspotNL` | never | newsletter form: skipped because a test lead would subscribe the test inbox. Pass --includ |
| `shopifyNLfooter` | never | newsletter form: skipped because a test lead would subscribe the test inbox. Pass --includ |
| `shopifyCart` | never | blocked: forbidden endpoint /cart (cart, checkout, order or payment endpoint) |
| `shopifyAdd` | never | blocked: forbidden endpoint /cart/add (cart, checkout, order or payment endpoint) |
| `shopifyRecover` | never | blocked: forbidden endpoint /account/recover (account, unsubscribe, delete, login, registe |
| `donation` | never | "donat" in headings; "donat" in page; "donat" in attrs |
| `donation2` | never | "donat" in headings; "donat" in page; "donat" in attrs |
| `donate3` | never | "Donat" in buttons; "donat" in headings; "donat" in page |
| `job` | never | file upload field |
| `jobNoFile` | never | "Apply" in buttons; "careers" in attrs; "cover_letter" in fields |
| `bookingCard` | never | card fields |
| `bookingCard2` | never | payment widget (Stripe, PayPal, Braintree, Square or a card element) inside the form |
| `reset` | never | "reset" in buttons; "reset" in headings; "reset" in page |
| `reset2` | never | "reset" in headings; "reset" in page; "recover" in attrs |
| `gdpr` | never | "gdpr" in headings; "gdpr" in page; "privacy-request" in attrs |
| `gdpr2` | never | "gdpr" in headings; "gdpr" in page; "gdpr" in attrs |
| `forum` | never | "forum" in headings; "forum" in page; "bbp" in attrs |
| `forum2` | never | "reply" in buttons; "forum" in headings; "forum" in page |
| `review` | never | "review" in buttons; "review" in headings; "review" in page |
| `review2` | never | "review" in buttons; "review" in headings; "review" in page |
| `testimonial` | never | "testimonial" in headings; "testimonial" in page; "testimonial" in attrs |
| `guestbook` | never | "guestbook" in buttons; "guestbook" in headings; "guestbook" in page |
| `rsvp` | never | "RSVP" in buttons; "rsvp" in headings; "rsvp" in page |
| `waitlist` | never | "waitlist" in buttons; "waitlist" in headings; "waitlist" in page |
| `webinar` | never | "Register" in buttons; "webinar" in buttons; "webinar" in headings |
| `report` | never | "Report this listing" in buttons |
| `refund` | never | "refund" in buttons; "refund" in headings; "refund" in page |
| `cancel` | never | blocked: forbidden endpoint /sink/cancel (account, unsubscribe, delete, login, register or |
| `postcomment` | never | "comment" in buttons; "Post" in buttons |
| `reviews-page` | never | "reviews" in headings; "reviews" in page |

Real contact forms from Contact Form 7, Gravity Forms, WPForms, Elementor, HubSpot, GoHighLevel and Shopify are accepted and tested; the suite asserts both lists against a local server.

## What it finds

- **Forms**: fields, action, method, required fields, honeypot fields, reCAPTCHA / hCaptcha / Turnstile. Flags forms that post to a missing address, over plain HTTP, or sit next to a JavaScript crash.
- **Email and phone links**: `mailto:` format, placeholder addresses, whether the domain can receive mail (MX), `tel:` links that are not dialable or not in E.164.
- **WhatsApp links** (`wa.me`, `api.whatsapp.com`): number format, prefilled text, and whether the link loads. It never sends a message.
- **Chat widgets**: Intercom, Crisp, Tawk.to, Tidio, HubSpot, Drift, LiveChat, Zendesk, GoHighLevel / LeadConnector, Facebook Messenger, detected by script signature, then checked for whether the widget actually rendered.
- **Booking links**: Calendly, Cal.com, GoHighLevel, Acuity links that resolve.
- **Mobile signals** (390x844 viewport): contact call-to-action in the first screen, submit button size and overlap, form hidden on phones.
- **With `submit`**: what a real submission does (HTTP result, confirmation shown, redirect, network errors) and, with IMAP, how long the first reply takes.

## 30-second quickstart

```bash
git clone https://github.com/waseemnasir2k26/lead-leak-audit.git
cd lead-leak-audit
npm install
npx playwright install chromium

npm run demo                      # fixture site, report in reports/demo/report.html
node src/cli.js scan https://your-site.example   # read-only audit of a site you own
```

Reports land in `./reports/report.html` and `./reports/report.json` (`--out <dir>` to change).

Test what a real lead does (only on a site you own):

```bash
node src/cli.js submit https://your-site.example --i-own-this-site --email test-inbox@your-site.example --dry-run   # show the plan
node src/cli.js submit https://your-site.example --i-own-this-site --email test-inbox@your-site.example   # shows the plan, asks y/N
```

Measure reply speed too (the inbox must receive your auto-reply):

```bash
export LLA_IMAP_HOST=imap.your-provider.example LLA_IMAP_USER=test-inbox@your-site.example LLA_IMAP_PASS=...
node src/cli.js submit https://your-site.example --i-own-this-site --email test-inbox@your-site.example --imap --wait 15
```

Requires Node 20+. `imapflow` is an optional dependency, only used by `--imap`.

## Safety rails

**Run this only on sites you own or have written permission to test.** `scan` is read-only. `submit` sends real test leads, so it has hard limits that you cannot turn off:

- **A human confirms first.** `submit` prints the plan (per form: page URL, heading, button text, fields, verdict and reason) and asks `y/N` before anything is sent. Without a terminal it refuses. `--yes` skips the prompt for unattended runs but requires `--only <n|#id|.class|text>`, so a scheduled run can never auto-pick forms.
- Refuses to run without `--i-own-this-site` (and without `--email`).
- Only touches the audited host (scheme-less, port-aware) plus hosts you list with `--allow-domain`.
- At most one submission per distinct form per run, at most 10 forms per run. Only forms that pass the allow-list above are eligible.
- If a CAPTCHA is present, the form is marked "blocked by CAPTCHA, test manually". The tool never tries to solve or bypass one.
- Test leads are marked: name `LEAD-LEAK-AUDIT TEST`, a message saying it is an automated test of your own site, and a unique test ID. Honeypot fields stay empty.
- `--dry-run` prints exactly what would be filled and sends nothing.
- WhatsApp is never contacted by design: links are validated and fetched, nothing more.
- IMAP details come from env vars only (never CLI arguments), are never logged, and are redacted from every report. The test inbox address is masked in the report.
- `robots.txt` is honoured for the pages visited and for the paths a submission would reach. Form actions are only probed on the scanned host; WhatsApp and booking links are never fetched at private, loopback or link-local addresses (unless the scanned site itself is on one), and connections go to the address that was checked.

Enforced again at the browser's network layer, whatever the form markup says:

- Every non-GET request, and every navigation after the submit click, is judged by its real URL: host allow-list, `robots.txt`, and a never-touch list (comments, cart, checkout, orders, payments, account, unsubscribe, delete, login, register, password). A button's `formaction`, an action set by script and `fetch()` calls are all covered. A blocked request is aborted and reported as "blocked: forbidden endpoint <path>", and the form counts as not submitted.
- Redirects are followed by the tool, not the browser: each hop is checked against the same rules, and one that leaves the allowed hosts is aborted and reported as "blocked: redirect to foreign host <host>". A confirmation page on a foreign host is never reported as delivered.
- Service workers are blocked. Foreign WebSockets and foreign GET beacons or images after the click are blocked and recorded in the report.
- New windows and tabs (`target="_blank"`, `window.open`) are watched, so their result is seen.
- Watchdogs: a whole-run cap (`--max-runtime`, default 10 minutes) and a per-form cap (`--form-timeout`, default 90 s); timeouts are reported.

Exit codes: `0` ok, `1` error, `2` CI check failed, `3` refused by a safety rail.

## Reply timing

With `--imap` the tool polls the test inbox for up to `--wait` minutes (default 15) and matches replies to forms by the unique test ID in the message.

| First reply | Bucket |
| ----------- | ------ |
| under 5 min | great  |
| under 1 h   | ok     |
| over 1 h    | leak   |
| none        | dead   |

Use a test inbox that is different from the address your site notifies, or the notification email will count as the "reply".

## Score

100 minus a penalty per leak: critical 25, high 15, medium 8, low 3, notes 0. Each area (forms, links, WhatsApp, chat, booking, mobile, speed, coverage) loses at most 40 points so one broken area does not hide the rest. 90+ Healthy, 70+ Leaky, 40+ Bleeding, below that Critical. Every leak in the report comes with a plain-English fix.

## Weekly check in n8n

`--ci --threshold 75` exits with code 2 when the score is too low; `--baseline` also fails on a drop versus the last report (a missing baseline is just "no baseline yet"; `--update-baseline` creates and advances it). [examples/n8n-weekly-check.json](examples/n8n-weekly-check.json) wires that to a Monday schedule and an email. Setup: [docs/n8n.md](docs/n8n.md).

## Options

```
lead-leak-audit scan <url>   [--max-pages 15] [--out dir] [--settle ms] [--no-link-check] [--no-mx-check] [--json] [--quiet]
lead-leak-audit submit <url> --i-own-this-site --email <inbox> [--allow-domain host] [--max-forms 10]
                             [--dry-run] [--only n|#id|.class|text] [--yes] [--include-newsletter] [--max-runtime 10] [--form-timeout 90] [--imap] [--wait 15]
CI: [--ci] [--threshold 70] [--baseline report.json] [--update-baseline] [--max-drop 10]
Both: [--open]  open report.html when done
```

## Limits

- **CAPTCHAs are never solved.** Those forms are listed for manual testing. A CAPTCHA that silently rejects real visitors cannot be detected.
- **Forms inside third-party iframes** (embedded HubSpot, Typeform, etc.) are not seen or submitted.
- **Single-page apps with custom widgets**: forms built without a `<form>` element and chat widgets with unknown markup can be missed or reported as "not rendered". Treat "installed but never appears" as a prompt to look, not proof.
- **Chat widgets** that appear only after a delay longer than `--settle`, a click, a consent banner or business hours look like failures.
- **WhatsApp**: the tool checks format and that the link loads. It cannot know whether the number is registered on WhatsApp.
- **Form actions** are probed with a harmless HEAD request; some servers answer HEAD differently from POST. Use `submit` for ground truth.
- **Reply timing** matches the test ID in the email text; replies that omit the original message and the ID are not matched. Clock differences between your machine and the mail server can shift results by a few seconds.
- Single-language heuristics for success and error messages (English and a few common words).
- Pages that need a login are out of scope.

## Development

```bash
npm test          # node --test: unit tests plus an end-to-end run against a local fixture site
npm run demo:sample   # regenerate examples/sample-report.html
```

Layout: `src/rules.js` (detectors), `src/inventory.js` and `src/findings.js` (what was found, what it means), `src/submit.js` (rails and outcomes), `src/report.js`, `examples/demo-site` (fixture).

## For you if

- You run ads, SEO or outbound and want to know the lead path is working before you spend more.
- You maintain client sites and want a weekly check that tells you when a form or button breaks.
- You can run a command line and own the sites you test.

Not for you if you want to test sites you do not control, or to get past a CAPTCHA.

## Want these leaks fixed?

Built by [SkynetLabs](https://skynetjoe.com). If the report shows leaks you would rather not fix yourself, we fix them: https://skynetjoe.com (info@skynetjoe.com).

License: MIT. See [CHANGELOG.md](CHANGELOG.md).
