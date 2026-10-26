// v1.2.5 allow-list: "accepted" needs a SUBMISSION-CONFIRMATION phrase (not a bare thank-you) AND an anchor that ties it
// to this submission: the form is gone/hidden, the phrase sits in a status/alert region, the URL is a thank-you address,
// or JSON says ok:true. No anchor = unconfirmed.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runSubmit } from "../src/run.js";
import { classifyOutcome } from "../src/submit.js";

const FORM = `<form action="/lead" method="post"><input name="name" placeholder="Your name"><input type="email" name="email"><textarea name="message" placeholder="Message"></textarea><button>Send message</button></form>`;
const HIDDEN_FORM = `<form action="/lead" method="post" style="display:none"><input name="name" placeholder="Your name"><input type="email" name="email"><textarea name="message" placeholder="Message"></textarea><button>Send message</button></form>`;

let server;
let url;
let pages = {}; // path -> html served on GET
let post = {}; // { location, status } = redirect after the POST; { html } = answer page

before(async () => {
  server = http.createServer((q, r) => {
    const u = new URL(q.url, "http://x");
    if (q.method === "POST" && u.pathname === "/lead") {
      q.resume();
      q.on("end", () => {
        if (post.location) {
          r.writeHead(post.status || 302, { location: post.location });
          return r.end();
        }
        r.writeHead(200, { "content-type": "text/html" });
        r.end(post.html || "");
      });
      return;
    }
    if (u.pathname === "/robots.txt") {
      r.writeHead(404);
      return r.end();
    }
    if (pages[u.pathname] !== undefined) {
      r.writeHead(200, { "content-type": "text/html" });
      return r.end(pages[u.pathname]);
    }
    r.writeHead(404);
    r.end();
  });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  url = `http://127.0.0.1:${server.address().port}/contact`;
});
after(async () => {
  await new Promise((res) => server.close(res));
});
beforeEach(() => {
  pages = { "/contact": `<h1>Contact us</h1>${FORM}` };
  post = {};
});

async function submit() {
  const { extra } = await runSubmit(url, {
    dwellMs: 0,
    iOwn: true,
    email: "qa@example.test",
    linkCheck: false,
    mxCheck: false,
    settleMs: 150,
    maxPages: 5,
    confirm: async () => true,
  });
  const s = extra.submissions.find((x) => /\/lead$/.test(x.action || ""));
  assert.ok(s, "the lead form was submitted");
  return s;
}

// --- The two R7 blockers, reproduced end to end ---

test("blocker 1: 302 to /blog/thank-you-to-our-sponsors with 'Thanks for reading our sponsor roundup.' is unconfirmed", async () => {
  pages["/blog/thank-you-to-our-sponsors"] =
    `<h1>Sponsor roundup</h1><p>Thanks for reading our sponsor roundup.</p>`;
  post = { location: "/blog/thank-you-to-our-sponsors" };
  const s = await submit();
  assert.equal(s.status, "unconfirmed", s.detail);
});

test("blocker 2: a 200 page with the form still shown and a timer-injected 'Thank you for subscribing to our newsletter!' is unconfirmed", async () => {
  post = {
    html: `${FORM}<script>setTimeout(function(){var p=document.createElement('p');p.textContent='Thank you for subscribing to our newsletter!';document.body.appendChild(p)},200)</script>`,
  };
  const s = await submit();
  assert.equal(s.status, "unconfirmed", s.detail);
});

test("blocker 2 (stronger): a timer-injected 'Thanks, we received your message' in plain body text, form still shown, is unconfirmed", async () => {
  post = {
    html: `${FORM}<script>setTimeout(function(){var p=document.createElement('p');p.textContent='Thanks, we received your message';document.body.appendChild(p)},200)</script>`,
  };
  const s = await submit();
  assert.equal(s.status, "unconfirmed", s.detail);
});

// --- Anchors ---

test("status anchor: 'Thanks, we received your message' in a role=status div (form still on the page) is accepted", async () => {
  post = {
    html: `${FORM}<div role="status">Thanks, we received your message</div>`,
  };
  const s = await submit();
  assert.equal(s.status, "accepted", s.detail);
});

test("form-hidden anchor: 'Thanks, we received your message' in a role=status div after the form is hidden is accepted", async () => {
  post = {
    html: `${HIDDEN_FORM}<div role="status">Thanks, we received your message</div>`,
  };
  const s = await submit();
  assert.equal(s.status, "accepted", s.detail);
});

test("thank-you address: 302 to /thank-you with 'Your message has been sent' is accepted", async () => {
  pages["/thank-you"] = `<h1>Thanks</h1><p>Your message has been sent.</p>`;
  post = { location: "/thank-you" };
  const s = await submit();
  assert.equal(s.status, "accepted", s.detail);
});

test("no exact thank-you address: 302 to /blog/thank-you-to-our-sponsors with 'Your message has been sent' and the form visible is unconfirmed", async () => {
  pages["/blog/thank-you-to-our-sponsors"] =
    `<h2>Contact us</h2>${FORM}<p>Your message has been sent.</p>`;
  post = { location: "/blog/thank-you-to-our-sponsors" };
  const s = await submit();
  assert.equal(s.status, "unconfirmed", s.detail);
});

test("no exact thank-you address: the same page with the form hidden counts as form-hidden and is accepted", async () => {
  pages["/blog/thank-you-to-our-sponsors"] =
    `<h2>Contact us</h2>${HIDDEN_FORM}<p>Your message has been sent.</p>`;
  post = { location: "/blog/thank-you-to-our-sponsors" };
  const s = await submit();
  assert.equal(s.status, "accepted", s.detail);
});

// --- Pure allow-list: what is and is not a submission-confirmation phrase ---

const base = {
  startUrl: "https://acme.test/contact",
  finalUrl: "https://acme.test/contact",
  textBefore: "Contact us",
};
const shown = (textAfter, extra = {}) =>
  classifyOutcome({
    ...base,
    textAfter: `Contact us\n${textAfter}`,
    relevant: [{ method: "POST", url: "https://acme.test/s", status: 200 }],
    formGone: true, // anchor present: only the phrase is under test
    ...extra,
  }).status;

test("not a confirmation: bare thank-you lines, even with an anchor", () => {
  assert.equal(
    shown("Thank you for subscribing to our newsletter!"),
    "unconfirmed",
  );
  assert.equal(shown("Thanks for reading our sponsor roundup."), "unconfirmed");
  assert.equal(shown("Thanks for visiting"), "unconfirmed");
  assert.equal(shown("Thank you for your message"), "unconfirmed");
});

test("confirmation phrases in the covered languages are accepted when anchored", () => {
  assert.equal(shown("Tu mensaje ha sido enviado"), "accepted");
  assert.equal(shown("Hemos recibido tu mensaje"), "accepted");
  assert.equal(shown("Mensaje enviado"), "accepted");
  assert.equal(shown("Votre message a bien été envoyé"), "accepted");
  assert.equal(shown("Nous avons bien reçu votre message"), "accepted");
  assert.equal(shown("Nachricht gesendet"), "accepted");
  assert.equal(shown("Wir haben Ihre Nachricht erhalten"), "accepted");
  assert.equal(shown("Mensagem enviada"), "accepted");
  assert.equal(shown("Recebemos a sua mensagem"), "accepted");
});

test("we'll be in touch is a promised reply, and counts as a confirmation phrase", () => {
  assert.equal(shown("Thanks! We'll be in touch shortly."), "accepted");
  assert.equal(shown("We will get back to you."), "accepted");
});

test("a confirmation phrase with no anchor is unconfirmed; JSON ok:true is an anchor", () => {
  assert.equal(
    shown("Your message has been sent.", { formGone: false }),
    "unconfirmed",
  );
  const json = classifyOutcome({
    ...base,
    textAfter: '{"ok":true}',
    relevant: [
      {
        method: "POST",
        url: "https://acme.test/s",
        status: 200,
        contentType: "application/json",
        body: '{"ok":true}',
      },
    ],
  });
  assert.equal(json.status, "accepted");
});

test("a success flag in the query is an anchor only after a navigation", () => {
  const withQuery = (finalUrl) =>
    classifyOutcome({
      ...base,
      finalUrl,
      textAfter: "Contact us\nYour message has been sent.",
      relevant: [
        { method: "POST", url: "https://acme.test/s", status: 302 },
        { method: "GET", url: finalUrl, status: 200 },
      ],
      formGone: false,
    }).status;
  assert.equal(withQuery("https://acme.test/contact?sent=1"), "accepted");
  assert.equal(withQuery("https://acme.test/contact?sent=0"), "unconfirmed");
});
