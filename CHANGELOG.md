# Changelog

## 1.2.6 - 2026-10-26

Closes three false "accepted" results from the R8 judge review. The page can write its own text, so the page is no longer evidence. Upgrade if you act on submission results.

- **"accepted" needs the server's own answer.** The DOM never proves a lead arrived. The tool keeps the response to the lead request (POST body, or the final body after its redirect chain) at the network layer and classifies that. A phrase counts only if it is a submission confirmation, is not already in the pre-submit page, and is not an error. No redirect: the POST answer carries it. Redirect: the final page carries it AND the final address is a thank-you address. JSON with `ok: true`, `success: true` or `status` `ok`/`success` stays accepted.
- **Removed as evidence:** form gone or hidden, status / alert / aria-live text, and the thank-you address alone. They remain display information only.
- **What the report shows.** A page that displays a confirmation the server did not confirm is reported as `unconfirmed — the page showed "…", but the server response did not confirm it`. The three judge repros now read that way: a 302 to a blog article with "Your message has been sent to our editors", a 302 to a blog page with "We received your request to subscribe", and a page script that writes "Thanks! Your message has been sent." over a blank 200.
- **Tests.** `test/server-evidence.test.js` (the three repros; POST 200 HTML answer accepted; fetch JSON `ok:true` accepted; 302 to `/thank-you` with the phrase in its body accepted; fetch HTML answer accepted; pre-submit HTML and error cues excluded). Updated to serve the phrase as the server answer, or to expect unconfirmed for DOM-only text: `test/confirm-allowlist.test.js` (the two status-region / form-hidden tests now serve the phrase in the POST answer; "form hidden at a non-thank-you address" is unconfirmed; a phrase in the page only is unconfirmed), `test/confirm-language.test.js` (the `run` helper serves the text as the server answer), `test/submit.test.js` (the outcome helpers serve the text as the POST answer), `test/neutral.test.js` (confirmation label is now `server-reply`).

## 1.2.5 - 2026-10-26

Closes two false "accepted" results found in the R7 judge review. Upgrade if you act on submission results.

- **"accepted" needs a submission-confirmation phrase, not a bare thank-you.** The phrase must name the submission (message, request, enquiry, inquiry, submission, form, details, or a covered-language equivalent) and say it was received, sent or submitted ("We received your message", "Message sent", "Tu mensaje ha sido enviado", "Nachricht gesendet"). Or it must promise a reply ("we'll be in touch", "we will get back to you"). "Thank you for subscribing", "Thanks for reading" and "Thanks for visiting" are not confirmations. The allow-list covers English, Spanish, French, German and Portuguese.
- **And an anchor ties it to this submission.** One of: (i) the submitted form is gone, hidden or replaced after submit; (ii) the phrase sits in a `role="status"`, `role="alert"` or `aria-live` region, or beside the form; (iii) the URL changed to a thank-you address (last path segment `thank-you`, `thanks`, `success`, `sent`, `confirmation` or `submitted`, optionally `.html`, or a query `sent=1`, `success=1` or `submitted=1`); (iv) a JSON answer with `ok: true`. With no anchor the outcome is "unconfirmed: the page shows a confirmation-style line ... but nothing ties it to this submission".
- **Blocked cases from the review:** a redirect to `/blog/thank-you-to-our-sponsors` with "Thanks for reading our sponsor roundup." is unconfirmed; a 200 page where the form stays and a timer adds "Thank you for subscribing to our newsletter!" is unconfirmed.
- **Behaviour changes to know about:** "Thank you for your message" on its own is now unconfirmed (no received/sent verb). A success line on a page where the form is still shown, with no status region or thank-you address, is unconfirmed. An English "Thank you! 🎉" is accepted only with a confirmation phrase and an anchor.
- Tests: `test/confirm-allowlist.test.js` (both blocker repros end to end; status-region, form-hidden and thank-you-address anchors; the covered-language allow-list). Updated: `test/submit.test.js` and `test/confirm-language.test.js` (accepted expectations now carry an anchor or a confirmation phrase).

## 1.2.4 - 2026-10-26

Closes a false "accepted" after a redirect. Upgrade if you act on submission results.

- **A redirect is judged on the text it added, not the whole destination page.** After a POST that redirects, only text that was not on the pre-submit page counts. A success phrase must sit in a new line of 200 characters or fewer.
- **A redirect to the home or index page is never a confirmation.** A 302 to `/`, `/home`, `/index` or `/index.html` that shows "Thanks for visiting our site" is "unconfirmed", not "accepted". A redirect to a thank-you URL, or to any other page with a new success line, is accepted as before (not verified; use `--imap`).
- **Emoji is not a non-Latin letter.** "Thank you! 🎉" in English is accepted; a test documents it.
- Tests: `test/redirect-outcome.test.js` (home redirect unconfirmed; `/thank-you` accepted; `/contact?sent=1` with new text accepted) and `test/confirm-language.test.js`.

## 1.2.3 - 2026-10-26

Closes two ways one lead could be sent twice or a non-English confirmation could be counted as delivered. Upgrade if you act on submission results.

- **One form, one lead.** A page that fetch()es the lead from its submit handler and then lets the native submit go out used to send two POSTs. After the click, the first non-GET request to an allowed host is the lead; every later one is aborted with "blocked: second submission for the same form". If the page tried more than once, the outcome says "The page tried to send N submissions; only the first was let through." and the record carries `submissionsAttempted`. Test: `test/one-submission.test.js` (the server receives exactly one POST).
- **Confirmations are an allow-list.** "accepted" needs (a) a success phrase from a covered language (English, Spanish, French, German, Portuguese) in the visible text, and (b) no letter outside the Latin script anywhere in the visible post-submit text. A thank-you URL is supporting evidence only. Any other success-looking text, including "ありがとう", "谢谢" and "감사합니다" on any page, is "unconfirmed: confirmation not in a language this tool checks". The six-letter threshold is removed. Test: `test/confirm-language.test.js`.

## 1.2.2 - 2026-10-26

Closes two ways a lead could be counted wrongly or sent twice. Upgrade if you act on submission results.

- **A 307 or 308 never re-sends the lead.** A 307/308 keeps the POST method, so following it submitted the lead a second time. The tool now aborts that re-send and reports "unconfirmed: the site answered with a 307/308 re-send redirect to <path>; the second submission was blocked to keep one lead per form". 301, 302 and 303 are still followed with a GET. Test: `test/resend-redirect.test.js` (the server receives exactly one POST).
- **Confirmation text in a language the tool cannot check is never "accepted".** Substantial non-Latin text (six or more letters: Japanese, Urdu script, Arabic, Cyrillic and others), or Latin text outside English, Spanish, French, German and Portuguese, is "unconfirmed: confirmation text is in a language this tool can't check (<language>); check manually or use --imap". Roman Urdu failure words (nahi hua, nahin bheja, masla, ghalti, dobara koshish) are error cues. Test: `test/confirm-language.test.js`.
- **Button text uses the same normaliser as the page scope.** Latin-script look-alikes such as U+0251 (ɑ) are folded to a before classification, so a donation button spelled with them is rejected. Test: `test/homoglyph.test.js`.

## 1.2.1 - 2026-10-26

Closes two ways a lead could be misread: a look-alike donation button submitted as a contact form, and a redirect counted as a confirmation. Upgrade if you act on submission results or rely on the form classifier.

- **Look-alike text is normalised before classification.** Labels, headings, buttons, placeholders, options, names and URLs are NFKC-normalised, stripped of Unicode format characters (zero-width space, soft hyphen, word joiner, bidi marks), lowercased, folded from common Cyrillic and Greek look-alikes to Latin, and whitespace-collapsed. A button with a Cyrillic o, a button with a zero-width space and a fullwidth donation button are all rejected. The endpoint gate still reads the raw URLs.
- **Obfuscated text is never submitted.** A visible word that mixes Latin with Cyrillic or Greek letters rejects the form with kind "obfuscated".
- **A 3xx redirect to a foreign host after a POST is "unconfirmed", not "accepted-redirect-blocked".** A 3xx only proves the server answered. The report says "unconfirmed: the site redirected to <host>, which the safety rail blocked; check that host's thank-you page manually", at the same severity as a blank-200 result. A redirect to the same host followed by a success page is still "accepted". Navigation by script or meta refresh keeps "accepted-redirect-blocked".
- **A 3xx to a forbidden endpoint on the same host is "unconfirmed" too.** A POST answered with a redirect to `/cart`, `/checkout` or another forbidden path was "accepted-redirect-blocked"; it is now "unconfirmed: the site redirected to <path>, which the safety rail blocked (HTTP n)", the same as the foreign-host case. `accepted-redirect-blocked` stays for script and meta-refresh navigation, which is the only case that proves the server received the lead.
- Tests: `test/homoglyph.test.js` (look-alike, zero-width and fullwidth buttons; normaliser; mixed-script words) and redirect cases in `submit.test.js`. The bypass and neutral redirect expectations now assert "unconfirmed".

## 1.2.0 - 2026-10-26

Renames the outcome levels so "delivered" means what it says. Upgrade if you read submission results.

- **"delivered" is reserved for an IMAP-confirmed reply.** Without `--imap` the best outcome is now **"accepted"**, shown as "Accepted by the site, not verified: run with --imap to confirm delivery". It is an OK result with an "unverified" info note and no penalty. `delivered-redirect-blocked` is renamed `accepted-redirect-blocked`. Report CSS classes and tests follow.
- **"accepted" needs positive evidence AND no negative cue.** One negative lexicon (`ERROR_RE`) covers English plus basic Spanish, French, German and Portuguese: not, n't, no longer, error, fail(ed/ure), unable, cannot, could not, problem, issue, try again, went wrong, rejected, "invalid" before a field word, no se pudo, error al, échec, impossible, nicht, fehler, falhou, erro. Any negative cue gives "error-message" without success wording and "unconfirmed" with it.
- **JSON responses are parsed.** A JSON answer with `ok:false`, `success:false`, `status:"error"` or a filled `error`/`errors` key is "error-message", whatever the text. `ok:true` or `success:true` with no error is positive evidence, and negative cues are scanned in its string values (not its keys).
- **Bare "spam" is no longer a negative cue.** "marked as spam" still is.
- Tests cover the new levels, the negative lexicon and JSON handling, and the IMAP path still reports "delivered".

## 1.1.2 - 2026-10-26

Fixes two report-truth bugs found in review. Upgrade if you used `submit`.

- **An error message is never "delivered".** Error wording now wins over success wording. "Thanks for your message, but it could not be sent. Please try again." is "unconfirmed"; error wording with no success wording (for example "Error: please try again") is "error-message". ERROR_RE gains "could not be sent", "couldn't be sent", "failed to send" (the rest of the list is unchanged). Covered by neutral fixtures.
- **No contradiction between the probe and the submission.** A HEAD probe that returns 404 or unreachable for a form action is no longer a critical "every submission is lost" finding when a real test POST to that action was sent in the same run. It becomes info: "GET not allowed on the form endpoint, normal for POST-only handlers"; the POST result decides. With no POST tested (scan only), the critical finding is unchanged.

## 1.1.1 - 2026-10-25

- **Classifier is a true AND.** Contact intent (heading, button, label, legend or recognised form-builder markup) AND a message/details field AND an email or phone field. A forum reply ("Re:" heading, "Write your answer"), a donation (number field plus $10/$25 radios), an RSVP (yes/no select) and rating/score inputs are rejected; so are currency symbols or amounts in labels, options and placeholders, yes/no/attending radios and selects, reply/answer/thread/topic wording, and any number or range input of unknown purpose. Unknown number inputs are never filled. Multi-step forms (a "Next" button, or hidden card fields) are rejected with "test manually". Tested with neutral fixture names (`/pageN`, title "Welcome").
- **Outcomes tell the truth.** "delivered" needs positive evidence (success text or a thank-you URL; an IMAP reply upgrades "unconfirmed"). A blank 200, a vanished form or a crash page ("fatal error", "uncaught", "exception", stack trace) is "unconfirmed". A redirect or navigation to a foreign or forbidden target after the POST was received is reported as "delivered-redirect-blocked": "received by your server (HTTP 302); the follow-up redirect to host/path was blocked by the safety rail". Our own aborts no longer show up as network errors, and a blocked meta-refresh no longer claims the visitor saw a confirmation. Every report says "delivery unverified without --imap".
- **Time traps and honeypots.** `--dwell` (default 6 s) between page load and submit, with human-pace typing and a few pointer moves. A visible field whose label, placeholder or name says to leave it empty ("leave blank", "do not fill", "bot", "honeypot") is never filled.
- `--only` must be precise: `""`, `/`, `.` and other short or punctuation-only values are refused; with `--yes` each token must match exactly one form.
- Forms in same-origin iframes are scanned and tested; cross-origin form embeds are listed as an info finding and count as a lead path.
- README documents third-party form services (skipped; `--allow-domain` opts in), the time-trap and honeypot behaviour, and generates the never-submit table from a real dry run (`npm run docs:table`). Git Bash users get a hint when no terminal is available.

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
