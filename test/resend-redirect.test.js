// A 307/308 answer to the lead POST must never re-send the lead: exactly one POST reaches the server.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runSubmit } from "../src/run.js";

let server;
let url;
const posts = [];

before(async () => {
  server = http.createServer((q, r) => {
    const u = new URL(q.url, "http://x");
    if (q.method === "POST" && u.pathname === "/lead") {
      posts.push(u.pathname);
      q.resume();
      q.on("end", () => {
        r.writeHead(307, { location: "/thank-you" });
        r.end();
      });
      return;
    }
    if (q.method === "POST") {
      posts.push(u.pathname);
      q.resume();
      q.on("end", () => {
        r.writeHead(200, { "content-type": "text/html" });
        r.end("<h1>Thank you</h1>");
      });
      return;
    }
    if (u.pathname === "/robots.txt") {
      r.writeHead(404);
      return r.end();
    }
    if (u.pathname === "/thank-you") {
      r.writeHead(200, { "content-type": "text/html" });
      return r.end("<h1>Thank you for your message</h1>");
    }
    r.writeHead(200, { "content-type": "text/html" });
    r.end(`<h1>Contact us</h1><form action="/lead" method="post">
      <input name="name" placeholder="Your name"><input type="email" name="email">
      <textarea name="message" placeholder="Message"></textarea><button>Send message</button></form>`);
  });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  url = `http://127.0.0.1:${server.address().port}/contact`;
});
after(async () => {
  await new Promise((res) => server.close(res));
});

test("307 to a same-host thank-you page: the lead is POSTed once and the re-send is blocked", async () => {
  posts.length = 0;
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
  assert.equal(posts.length, 1, `POSTs seen by the server: ${posts}`);
  const s = extra.submissions.find((x) => /\/lead$/.test(x.action || ""));
  assert.ok(s, "the lead form was submitted");
  assert.match(
    s.detail,
    /^unconfirmed: the site answered with a 307\/308 re-send redirect to \/thank-you; the second submission was blocked to keep one lead per form/,
  );
  assert.equal(s.status, "unconfirmed");
});
