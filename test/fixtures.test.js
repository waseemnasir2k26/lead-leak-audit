import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, inventoryFromFixture } from "./helpers.js";

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

test("forms fixture: kinds, honeypot, required fields, CAPTCHA", async () => {
  const { inventory } = await inventoryFromFixture(browser, "forms.html");
  const byKind = (k) => inventory.forms.filter((f) => f.kind === k);
  assert.equal(byKind("search").length, 1);
  assert.equal(byKind("login").length, 1);
  assert.equal(byKind("newsletter").length, 1);
  const contact = byKind("contact");
  assert.equal(contact.length, 3);
  const plain = contact.find((f) => !f.captcha.present);
  assert.deepEqual(plain.honeypots, ["website_url"]);
  assert.equal(plain.required, 2);
  assert.equal(plain.method, "post");
  assert.ok(plain.actionAbs.endsWith("/api/lead"));
  assert.equal(plain.fields.find((f) => f.name === "name").label, "Your name");
  const kinds = contact
    .map((f) => f.captcha.kind)
    .filter(Boolean)
    .sort();
  assert.deepEqual(kinds, ["Cloudflare Turnstile", "reCAPTCHA"]);
});

test("links fixture: mailto, tel, WhatsApp, booking, chat vendors", async () => {
  const { inventory } = await inventoryFromFixture(browser, "links.html");
  assert.equal(inventory.mailto.length, 3);
  assert.equal(inventory.mailto.filter((m) => m.analysis.valid).length, 1);
  assert.equal(inventory.tel.length, 3);
  assert.equal(inventory.tel.filter((t) => t.analysis.e164).length, 1);
  assert.equal(inventory.whatsapp.length, 3);
  assert.equal(inventory.whatsapp.filter((w) => w.analysis.valid).length, 2);
  assert.equal(inventory.booking.length, 2);
  assert.deepEqual(inventory.chat.map((c) => c.vendor).sort(), [
    "Intercom",
    "Tawk.to",
    "Tidio",
  ]);
  assert.ok(inventory.chat.every((c) => c.rendered === false));
});

test("chat fixture: rendered widget vs installed-but-absent widget", async () => {
  const { inventory } = await inventoryFromFixture(
    browser,
    "chat-rendered.html",
  );
  const crisp = inventory.chat.find((c) => c.vendor === "Crisp");
  const tidio = inventory.chat.find((c) => c.vendor === "Tidio");
  assert.equal(crisp.rendered, true);
  assert.equal(tidio.rendered, false);
});
