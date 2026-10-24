# Changelog

## 1.0.0 - 2026-10-24

First release.

- `scan`: read-only crawl (same origin, robots.txt aware, default 15 pages) that inventories forms, mailto/tel links, WhatsApp links, chat widgets, booking links and mobile page signals.
- `submit`: one clearly marked test lead per distinct form, behind `--i-own-this-site`, a domain allow-list, a 10-form cap and a CAPTCHA stop. `--dry-run` prints the plan without submitting.
- Optional IMAP reply timing (`imapflow`, credentials from env only) with speed-to-lead buckets.
- Lead survival score (0-100), `report.html` (single file) and `report.json`, with IMAP credentials redacted.
- `--ci` / `--threshold` / `--baseline` exit codes, `examples/n8n-weekly-check.json`, `docs/n8n.md`.
- `npm run demo` serves a fixture site with deliberate leaks and writes a report.
