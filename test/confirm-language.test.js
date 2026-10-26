// Confirmation text in a language the tool cannot check is never "accepted": it is "unconfirmed" with the reason.
import test from "node:test";
import assert from "node:assert/strict";
import { classifyOutcome, ERROR_RE } from "../src/submit.js";

const base = {
  startUrl: "https://acme.test/contact",
  finalUrl: "https://acme.test/contact",
  textBefore: "Contact us",
};
const run = (textAfter) =>
  classifyOutcome({
    ...base,
    textAfter: `Contact us\n${textAfter}`,
    relevant: [{ method: "POST", url: "https://acme.test/s", status: 200 }],
  });
const LANG = /unconfirmed: confirmation text is in a language this tool can't check \(/;

test("Japanese thank-you with a failure sentence is unconfirmed, never accepted", () => {
  const o = run("ありがとうございます。送信できませんでした。");
  assert.equal(o.status, "unconfirmed");
  assert.match(o.detail, LANG);
  assert.match(o.detail, /Japanese/);
  assert.match(o.detail, /check manually or use --imap/);
});

test("Urdu-script success text is unconfirmed (not accepted)", () => {
  const o = run("شکریہ۔ آپ کا پیغام موصول ہو گیا ہے");
  assert.equal(o.status, "unconfirmed");
  assert.match(o.detail, LANG);
});

test("Arabic-script success text is unconfirmed", () => {
  const o = run("شكرا لك. تم إرسال رسالتك بنجاح");
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

test("English success is still accepted", () => {
  const o = run("Thank you, your message has been sent");
  assert.equal(o.status, "accepted");
});

test("Covered Spanish success is still accepted", () => {
  const o = run("Gracias, su mensaje ha sido enviado");
  assert.equal(o.status, "accepted");
});
