# Changelog

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
