# Changelog

## 1.1.0 - 2026-10-25

Redesign of form selection and of the network guard. Upgrade if you used `submit`.

- **Strict allow-list.** A form is a lead form only with positive signals (message/enquiry box or contact wording, plus an email or phone field) and no negative signal in button text, labels, headings, select options, field names, form attributes or the page URL/title. Comment, review, rating, forum, donation, amount/price/quantity, refund, cancel, unsubscribe, erase, delete, GDPR, password, reset, recover, register, sign-up, RSVP, waitlist, webinar, checkout, payment, card, Stripe/PayPal/Braintree/Square, job-application and upload forms are rejected with a reason. The tool never fills an `amount`. Email-only password-reset, RSVP, waitlist and webinar forms are no longer treated as newsletters. Class names such as "shopify" or "profile" no longer reject a real contact form; the action path and the signals decide.
- **Human confirmation.** `submit` prints the plan (page, heading, button text, fields, verdict and reason per form) and asks y/N. No terminal means refusal. `--yes` requires `--only`.
- **Redirect rail.** The tool follows redirects itself, checking every hop against the host allow-list, forbidden endpoints and robots.txt; a hop that fails is aborted and reported as "blocked: redirect to foreign host". A confirmation page on a foreign host is never "delivered". Service workers are blocked; foreign WebSockets and foreign GET beacons after the click are blocked and recorded.
- `target="_blank"` and `window.open` results are now seen (the whole browser context is watched), so they no longer show as "sent nothing". Form lookup at submit time requires an exact signature match and re-judges the live form.
- Watchdogs: `--max-runtime` (default 10 min) and `--form-timeout` (default 90 s); timeouts are reported.
- Tests: vendor-shape fixtures (Contact Form 7, Gravity Forms, WPForms, Elementor, HubSpot, GoHighLevel, Shopify and 28 look-alike forms) and bypass fixtures (fetch, beacon, XHR, popup, redirect chain, meta refresh, service worker, image GET, WebSocket), each asserting zero foreign hits.

## 1.0.2 - 2026-10-25

Safety release. Upgrade if you used `submit`.

- **Network-layer gate.** The DOM classification is no longer the only defence. Inside the browser, every outgoing non-GET request, and every navigation or fetch/XHR once a submit is armed, is judged by its real URL: host allow-list, `robots.txt`, and a never-touch list (comments, cart, add-to-cart, checkout, orders, payments, unsubscribe, delete, account, register, password, login, reset, sign-up). Forbidden requests are aborted, reported as "blocked: forbidden endpoint <path>", and the form counts as not submitted. This also covers a submit button's `formaction`, a `formaction` set by script at click time, and `fetch()` calls from a submit handler.
- The DOM classifier now also reads every submit control's `formaction`/`formmethod` and controls attached with `form="id"` from outside the `<form>` tag. Form de-duplication now takes the form id, submit targets and hidden field names into account, so look-alike forms are no longer merged.
- Private-address guard rewritten: IPv4 in decimal/octal/hex/short forms, IPv6 expanded and checked (IPv4-mapped `::ffff:7f00:1`, IPv4-compatible `::7f00:1`, NAT64, 6to4, ULA `fc00::/7`, link-local `fe80::/10`, multicast, Teredo), plus 0.0.0.0/8, 100.64/10 and other reserved ranges. Link checks connect through a lookup that validates the resolved address and connects to that same address, so DNS rebinding cannot swap in a private IP. Redirect hops are checked too.
- GoHighLevel booking detection accepts only known GHL/LeadConnector hosts, or a `/widget/booking/` path on the scanned site's own host.
- `--open` on Windows uses `explorer.exe` with an argument array instead of `cmd /c start`, so paths containing `&` and other shell characters are safe.

## 1.0.1 - 2026-10-25

Safety release. Upgrade if you used `submit`.

- `submit` is now an allow-list. Comment, cart/checkout/payment, unsubscribe/delete/account/register, login, search and file-upload forms are classified and never submitted, even with `--only`. Only enquiry-style forms (name or message field plus email or phone) are eligible.
- Newsletter forms are skipped unless `--include-newsletter` is passed. New `--only <n|#id|.class|text>` targets specific forms; `--dry-run` shows every form with its reason and number.
- Host comparison now includes the port (default 80/443 normalised). The in-browser guard aborts any cross-origin navigation or non-GET request from a form, including ones created by page JavaScript, and reports it as "blocked: foreign host". End-to-end tests cover this against a second local server.
- `submit` honours `robots.txt` for the pages it visits.
- Scan no longer probes form actions on other hosts, and never requests WhatsApp/booking links (or their redirects) at private, loopback or link-local addresses unless the scanned site itself is on one.
- A missing or unreadable `--baseline` file is "no baseline yet" instead of a crash, so the first scheduled n8n run no longer reports a false failure. New `--update-baseline` creates and advances the baseline; the n8n example uses it.
- New `--open` flag. README: "What it will never touch", zero-install `npx` line, animated demo, report screenshots.

## 1.0.0 - 2026-10-24

First release.

- `scan`: read-only crawl (same origin, robots.txt aware, default 15 pages) that inventories forms, mailto/tel links, WhatsApp links, chat widgets, booking links and mobile page signals.
- `submit`: one clearly marked test lead per distinct form, behind `--i-own-this-site`, a domain allow-list, a 10-form cap and a CAPTCHA stop. `--dry-run` prints the plan without submitting.
- Optional IMAP reply timing (`imapflow`, credentials from env only) with speed-to-lead buckets.
- Lead survival score (0-100), `report.html` (single file) and `report.json`, with IMAP credentials redacted.
- `--ci` / `--threshold` / `--baseline` exit codes, `examples/n8n-weekly-check.json`, `docs/n8n.md`.
- `npm run demo` serves a fixture site with deliberate leaks and writes a report.
