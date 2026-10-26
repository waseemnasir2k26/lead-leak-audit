// A 302 after the lead POST is judged on the NEW text only, and a redirect to the home page never counts as a confirmation.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runSubmit } from "../src/run.js";

let server;
let url;
let redirectTo = "/home";

before(async () => {
  server = http.createServer((q, r) => {
    const u = new URL(q.url, "http://x");
    if (q.method === "POST" && u.pathname === "/lead") {
      q.resume();
      q.on("end", () => {
        r.writeHead(302, { location: redirectTo });
        r.end();
      });
      return;
    }
    if (u.pathname === "/robots.txt") {
      r.writeHead(404);
      return r.end();
    }
    const page = (body) => {
      r.writeHead(200, { "content-type": "text/html" });
      r.end(body);
    };
    if (u.pathname === "/home")
      return page("<h1>Welcome</h1><p>Thanks for visiting our site</p>");
    if (u.pathname === "/thank-you")
      return page("<h1>Thank you</h1><p>Thanks, we received your message</p>");
    if (u.pathname === "/contact" && u.searchParams.get("sent") === "1")
      return page(
        `<h1>Contact us</h1><p>Thank you, your message has been sent</p>${FORM}`,
      );
    page(`<h1>Contact us</h1>${FORM}`);
  });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  url = `http://127.0.0.1:${server.address().port}/contact`;
});
after(async () => {
  await new Promise((res) => server.close(res));
});

const FORM = `<form action="/lead" method="post">
  <input name="name" placeholder="Your name"><input type="email" name="email">
  <textarea name="message" placeholder="Message"></textarea><button>Send message</button></form>`;

async function submitTo(target) {
  redirectTo = target;
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

test("302 to /home with generic 'Thanks for visiting our site' is unconfirmed, not accepted", async () => {
  const s = await submitTo("/home");
  assert.equal(s.status, "unconfirmed", s.detail);
});

test("302 to /thank-you with 'Thanks, we received your message' is accepted", async () => {
  const s = await submitTo("/thank-you");
  assert.equal(s.status, "accepted", s.detail);
});

test("302 to /contact?sent=1 where 'Thank you, your message has been sent' is new text is accepted", async () => {
  const s = await submitTo("/contact?sent=1");
  assert.equal(s.status, "accepted", s.detail);
});
