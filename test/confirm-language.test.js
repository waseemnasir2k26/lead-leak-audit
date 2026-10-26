// Allow-list: "accepted" needs a covered-language success phrase (en/es/fr/de/pt) AND no non-Latin letter in the visible
// post-submit text. Any other success-looking text is "unconfirmed: confirmation not in a language this tool checks".
import test from "node:test";
import assert from "node:assert/strict";
import { classifyOutcome, ERROR_RE } from "../src/submit.js";

const base = {
  startUrl: "https://acme.test/contact",
  finalUrl: "https://acme.test/contact",
  textBefore: "Contact us",
};
const run = (textAfter, finalUrl = base.finalUrl) =>
  classifyOutcome({
    ...base,
    finalUrl,
    textAfter: `Contact us\n${textAfter}`,
    relevant: [{ method: "POST", url: "https://acme.test/s", status: 200 }],
  });
const LANG = /^unconfirmed: confirmation not in a language this tool checks\./;

// The four judge cases: short non-Latin confirmations are never accepted, on any page.
test("judge: ありがとう is unconfirmed", () => {
  const o = run("ありがとう");
  assert.equal(o.status, "unconfirmed");
  assert.match(o.detail, LANG);
});
test("judge: 谢谢 is unconfirmed", () => {
  const o = run("谢谢");
  assert.equal(o.status, "unconfirmed");
  assert.match(o.detail, LANG);
});
test("judge: 감사합니다 is unconfirmed", () => {
  const o = run("감사합니다");
  assert.equal(o.status, "unconfirmed");
  assert.match(o.detail, LANG);
});
test("judge: 谢谢 on /thank-you is unconfirmed (the URL is not enough)", () => {
  const o = run("谢谢", "https://acme.test/thank-you");
  assert.equal(o.status, "unconfirmed");
  assert.match(o.detail, LANG);
});
test("judge: ありがとう and 감사합니다 on /thank-you are unconfirmed too", () => {
  assert.equal(
    run("ありがとう", "https://acme.test/thank-you").status,
    "unconfirmed",
  );
  assert.equal(
    run("감사합니다", "https://acme.test/thank-you").status,
    "unconfirmed",
  );
});

test("Japanese thank-you with a failure sentence is unconfirmed, never accepted", () => {
  const o = run("ありがとうございます。送信できませんでした。");
  assert.equal(o.status, "unconfirmed");
  assert.match(o.detail, LANG);
  assert.match(o.detail, /Check manually or use --imap./);
});

test("Arabic-script and Urdu-script success text is unconfirmed", () => {
  assert.equal(run("شکریہ۔ آپ کا پیغام موصول ہو گیا ہے").status, "unconfirmed");
  assert.equal(run("شكرا لك. تم إرسال رسالتك بنجاح").status, "unconfirmed");
});

test("a covered English phrase next to a non-Latin letter is not accepted (the visible text must be Latin)", () => {
  const o = run("Thank you, your message has been sent. ✔ Привет");
  assert.equal(o.status, "unconfirmed");
  assert.match(o.detail, LANG);
});

test("Italian success (not a covered language) is unconfirmed", () => {
  const o = run("Grazie, messaggio inviato");
  assert.equal(o.status, "unconfirmed");
  assert.match(o.detail, LANG);
});

test("Roman Urdu failure is an error cue, never accepted", () => {
  assert.ok(ERROR_RE.test("Aap ka message nahi hua"));
  assert.ok(ERROR_RE.test("Message nahin bheja gaya"));
  assert.ok(ERROR_RE.test("Masla hai, dobara koshish karein"));
  assert.ok(ERROR_RE.test("Ghalti ho gayi"));
  const o = run("Shukriya. Aap ka message nahi hua. Dobara koshish karein.");
  assert.notEqual(o.status, "accepted");
  assert.equal(o.status, "unconfirmed");
});

test("Roman Urdu success (no negative word) is unconfirmed: the language is not covered", () => {
  const o = run("Shukriya, aap ka message mil gaya hai");
  assert.equal(o.status, "unconfirmed");
  assert.match(o.detail, LANG);
});

test("English success is accepted", () => {
  const o = run("Thank you, your message has been sent");
  assert.equal(o.status, "accepted");
});

test("English text on /thank-you is accepted", () => {
  const o = run("Thank you for your message", "https://acme.test/thank-you");
  assert.equal(o.status, "accepted");
  assert.equal(o.redirect, "https://acme.test/thank-you");
});

test("a /thank-you URL with no visible text is not accepted on its own", () => {
  const o = run("", "https://acme.test/thank-you");
  assert.equal(o.status, "unconfirmed");
});

test("Covered Spanish success is accepted", () => {
  const o = run("Gracias, su mensaje ha sido enviado");
  assert.equal(o.status, "accepted");
});

// Documented behaviour: an emoji is not a letter in any script, so an English thank-you with an emoji is accepted.
test("English 'Thank you! 🎉' is accepted (emoji is not a non-Latin letter; intended)", () => {
  const o = run("Thank you! 🎉");
  assert.equal(o.status, "accepted");
});
