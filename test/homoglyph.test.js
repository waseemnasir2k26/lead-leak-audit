// Obfuscated button, label and heading text: the classifier reads canonical text, so look-alike spellings are rejected.
import test from "node:test";
import assert from "node:assert/strict";
import { assessForm, normaliseText, mixedScriptWord } from "../src/classify.js";

const contact = (over = {}) => ({
  heading: "Contact us",
  submitTexts: ["Send message"],
  fields: [
    {
      tag: "input",
      type: "text",
      name: "name",
      label: "Your name",
      visible: true,
    },
    {
      tag: "input",
      type: "email",
      name: "email",
      label: "Email",
      visible: true,
    },
    {
      tag: "textarea",
      type: "textarea",
      name: "message",
      label: "Message",
      visible: true,
    },
  ],
  ...over,
});

test("a plain contact form is still a lead", () => {
  assert.equal(assessForm(contact()).verdict, "lead");
});

test("homoglyph donation button (Cyrillic o) is rejected as obfuscated, never submitted", () => {
  const a = assessForm(contact({ submitTexts: ["D\u043Enate now"] }));
  assert.equal(a.verdict, "reject");
  assert.equal(a.kind, "obfuscated");
  assert.match(a.reasons[0], /mixes Latin with Cyrillic or Greek/);
});

test("zero-width space inside a donation button is stripped, then rejected as a donation", () => {
  const a = assessForm(contact({ submitTexts: ["Don\u200Bate now"] }));
  assert.equal(a.verdict, "reject");
  assert.equal(a.kind, "donation");
});

test("fullwidth donation button is folded by NFKC, then rejected", () => {
  const a = assessForm(
    contact({ submitTexts: ["\uFF24\uFF4F\uFF4E\uFF41\uFF54\uFF45 now"] }),
  );
  assert.equal(a.verdict, "reject");
  assert.equal(a.kind, "donation");
});

test("homoglyph inside a field label is rejected as obfuscated", () => {
  const form = contact();
  form.fields[2].label = "Your m\u0435ssage";
  const a = assessForm(form);
  assert.equal(a.verdict, "reject");
  assert.equal(a.kind, "obfuscated");
});

test("homoglyph in a placeholder or option text is rejected too", () => {
  const withPlaceholder = contact();
  withPlaceholder.fields[0].placeholder = "Full n\u0430me";
  assert.equal(assessForm(withPlaceholder).kind, "obfuscated");
  const withOption = contact({
    fields: [
      ...contact().fields,
      {
        tag: "select",
        name: "topic",
        label: "Topic",
        visible: true,
        options: [{ text: "Gen\u0435ral enquiry", value: "g" }],
      },
    ],
  });
  assert.equal(assessForm(withOption).kind, "obfuscated");
});

test("a Cyrillic-only word or Latin and Cyrillic in separate words is not a mixed-script word", () => {
  assert.equal(mixedScriptWord("\u041F\u0440\u0438\u0432\u0435\u0442"), null);
  assert.equal(
    mixedScriptWord("Donate \u041F\u0440\u0438\u0432\u0435\u0442"),
    null,
  );
  assert.equal(mixedScriptWord("D\u043Enate"), "D\u043Enate");
});

test("normaliseText: NFKC, format characters, case, confusables and whitespace", () => {
  assert.equal(
    normaliseText("  \uFF24\uFF4F\uFF4E\uFF41\uFF54\uFF45\u00A0NOW\u200B "),
    "donate now",
  );
  assert.equal(normaliseText("Don\u200Bate\u00AD now\u200E"), "donate now");
  assert.equal(normaliseText("D\u043Enate"), "donate");
  assert.equal(normaliseText("\u0395\u03bd\u03c4\u03c1\u03c5"), "evtpu");
});

test("Latin-script look-alike (U+0251 alpha) in a donation button is folded and rejected; same in the page title", () => {
  const button = assessForm(contact({ submitTexts: ["Don\u0251te now"] }));
  assert.equal(button.verdict, "reject");
  assert.equal(button.kind, "donation");
  const page = assessForm(contact({ pageTitle: "Don\u0251te" }));
  assert.equal(page.verdict, "reject");
  assert.equal(page.kind, "donation");
  assert.equal(normaliseText("\u0251\u0131"), "ai");
});
