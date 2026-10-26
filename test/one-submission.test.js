// One form, one lead: a submit handler that fetch()es the lead and then lets the native submit go out must reach the
// server with exactly ONE POST. The second non-GET is aborted and the outcome says so.
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
    if (u.pathname === "/robots.txt") {
      r.writeHead(404);
      return r.end();
    }
    if (q.method === "POST") {
      posts.push(`${u.pathname}`);
      q.resume();
      q.on("end", () => {
        r.writeHead(200, { "content-type": "text/plain" });
        r.end("Thank you, your message has been sent.");
      });
      return;
    }
    r.writeHead(200, { "content-type": "text/html" });
    r.end(`<h1>Contact us</h1>
      <div id="out"></div>
      <form action="/lead" method="post" id="f">
        <input name="name" placeholder="Your name">
        <input type="email" name="email">
        <textarea name="message" placeholder="Message"></textarea>
        <button>Send message</button>
      </form>
      <script>
        // The page sends the lead itself AND lets the native submit go out: two POSTs for one click.
        document.getElementById("f").addEventListener("submit", () => {
          fetch("/api/lead", { method: "POST", body: new FormData(document.getElementById("f")) })
            .then((x) => x.text())
            .then((t) => { document.getElementById("out").textContent = t; });
        });
      </script>`);
  });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  url = `http://127.0.0.1:${server.address().port}/contact`;
});
after(async () => {
  await new Promise((res) => server.close(res));
});

test("a page that fetch()es the lead and then submits natively: the server receives exactly 1 POST", async () => {
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
  const s = extra.submissions.find((x) => x.submissionsAttempted);
  assert.ok(
    s,
    `the second submission was counted: ${JSON.stringify(extra.submissions)}`,
  );
  assert.equal(s.submissionsAttempted, 2);
  assert.match(
    s.detail,
    /The page tried to send 2 submissions; only the first was let through\./,
  );
  assert.ok(
    (s.blockedRequests || []).some((b) =>
      /blocked: second submission for the same form/.test(b),
    ),
    `blocked requests: ${JSON.stringify(s.blockedRequests)}`,
  );
});
