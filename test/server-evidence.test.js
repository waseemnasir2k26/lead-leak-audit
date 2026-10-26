// v1.2.6: "accepted" needs SERVER evidence. DOM text (the page's own script, a status region, a vanished form, a thank-you
// address with no server phrase) never proves the lead arrived. The judge's three false "accepted" cases are pinned here.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runSubmit } from "../src/run.js";
import { classifyOutcome, htmlToText } from "../src/submit.js";

const FORM = (action) =>
  `<form action="${action}" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send message</button></form>`;
// A page script that writes a success line into the DOM itself, then posts with fetch.
const JS_WRITES_DOM = `<script>document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();const f=e.target;const d=document.createElement('p');d.textContent='Thanks! Your message has been sent.';f.parentElement.appendChild(d);fetch(f.action,{method:'POST',body:new FormData(f)});});</script>`;
const JS_FETCH_ONLY = `<script>document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();const f=e.target;fetch(f.action,{method:'POST',body:new FormData(f)});});</script>`;

// key = the case. post = the server's answer to the lead POST; redirect = a same-site sub-path the POST points at.
const CASES = {
  // The three judge repros (R8 58).
  repro1: {
    redirect: "/blog/post",
    pages: {
      "/blog/post":
        "<h1>Sponsor news</h1><p>Lots of text about sponsors.</p><p>Your message has been sent to our editors.</p>",
    },
  },
  repro2: {
    redirect: "/blog/roundup",
    pages: {
      "/blog/roundup":
        "<h1>Roundup</h1><p>We received your request to subscribe to the newsletter.</p>",
    },
  },
  repro3: {
    ajax: true,
    script: JS_WRITES_DOM,
    post: { status: 200, type: "text/html", body: "" },
  },
  // The accepted paths.
  html200: {
    post: {
      status: 200,
      type: "text/html",
      body: "<h1>Contact us</h1><p>Thanks, we received your message</p>",
    },
  },
  jsonOk: {
    ajax: true,
    script: JS_FETCH_ONLY,
    post: { status: 200, type: "application/json", body: '{"ok":true}' },
  },
  redirectThanks: {
    redirect: "/thank-you",
    pages: {
      "/thank-you": "<h1>Thanks</h1><p>Your message has been sent.</p>",
    },
  },
  fetchHtml: {
    ajax: true,
    script: JS_FETCH_ONLY,
    post: {
      status: 200,
      type: "text/html",
      body: "<div><p>Thank you, your enquiry was submitted.</p></div>",
    },
  },
};

let server;
let base;
const posts = {};

before(async () => {
  server = http.createServer((q, r) => {
    const u = new URL(q.url, "http://x");
    if (u.pathname === "/robots.txt") {
      r.writeHead(404);
      return r.end();
    }
    const key = u.pathname.split("/")[1];
    const sub = "/" + u.pathname.split("/").slice(2).join("/");
    const cfg = CASES[key];
    if (!cfg) {
      r.writeHead(404);
      return r.end();
    }
    if (q.method === "POST" && sub === "/lead") {
      posts[key] = (posts[key] || 0) + 1;
      q.resume();
      q.on("end", () => {
        if (cfg.redirect) {
          r.writeHead(302, { location: `/${key}${cfg.redirect}` });
          return r.end();
        }
        r.writeHead(cfg.post.status, { "content-type": cfg.post.type });
        r.end(cfg.post.body);
      });
      return;
    }
    const page = (html) => {
      r.writeHead(200, { "content-type": "text/html" });
      r.end(html);
    };
    if (sub === "/contact")
      return page(
        `<h1>Contact us</h1>${FORM(`/${key}/lead`)}${cfg.script || ""}`,
      );
    if (cfg.pages && cfg.pages[sub]) return page(cfg.pages[sub]);
    r.writeHead(404);
    r.end();
  });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((res) => server.close(res));
});

async function submit(key) {
  const { extra } = await runSubmit(`${base}/${key}/contact`, {
    dwellMs: 0,
    iOwn: true,
    email: "qa@example.test",
    linkCheck: false,
    mxCheck: false,
    settleMs: 300,
    maxPages: 3,
    confirm: async () => true,
  });
  const s = extra.submissions.find((x) => /\/lead$/.test(x.action || ""));
  assert.ok(s, `the lead form for ${key} was submitted`);
  return s;
}

// --- The judge's three false "accepted" cases: now unconfirmed, with what the page showed ---

test("judge repro 1: 302 to a blog article containing 'Your message has been sent to our editors' is unconfirmed", async () => {
  const s = await submit("repro1");
  assert.equal(s.status, "unconfirmed", s.detail);
  assert.match(
    s.detail,
    /^unconfirmed — the page showed "Your message has been sent to our editors/,
  );
  assert.match(s.detail, /but the server response did not confirm it/);
  assert.equal(posts.repro1, 1, "one lead");
});

test("judge repro 2: 302 to a blog page with 'We received your request to subscribe' is unconfirmed", async () => {
  const s = await submit("repro2");
  assert.equal(s.status, "unconfirmed", s.detail);
  assert.match(
    s.detail,
    /the page showed "We received your request to subscribe/,
  );
  assert.equal(posts.repro2, 1, "one lead");
});

test("judge repro 3: a page script writes 'Thanks! Your message has been sent.' while the server answers an empty 200 is unconfirmed", async () => {
  const s = await submit("repro3");
  assert.equal(s.status, "unconfirmed", s.detail);
  assert.match(
    s.detail,
    /the page showed "Thanks! Your message has been sent\."/,
  );
  assert.equal(posts.repro3, 1, "one lead");
});

// --- Server evidence that IS accepted ---

test("POST 200 HTML answer 'Thanks, we received your message' is accepted (rule B i)", async () => {
  const s = await submit("html200");
  assert.equal(s.status, "accepted", s.detail);
  assert.match(s.detail, /the server's own response confirmed it/);
});

test("fetch answering JSON {ok:true} is accepted", async () => {
  const s = await submit("jsonOk");
  assert.equal(s.status, "accepted", s.detail);
});

test("302 to /thank-you whose server body says 'Your message has been sent' is accepted (rule B ii)", async () => {
  const s = await submit("redirectThanks");
  assert.equal(s.status, "accepted", s.detail);
  assert.equal(
    s.redirect?.endsWith("/redirectThanks/thank-you"),
    true,
    s.redirect,
  );
});

test("fetch answering HTML (not JSON) with 'Thank you, your enquiry was submitted' is accepted (rule B i)", async () => {
  const s = await submit("fetchHtml");
  assert.equal(s.status, "accepted", s.detail);
  assert.equal(posts.fetchHtml, 1, "one lead");
});

// --- Pure classifier rules behind the e2e cases ---

const base0 = {
  startUrl: "https://acme.test/contact",
  finalUrl: "https://acme.test/contact",
  textBefore: "Contact us",
  textAfter: "Contact us",
};
const withReply = (reply, extra = {}) =>
  classifyOutcome({
    ...base0,
    relevant: [
      {
        method: "POST",
        url: "https://acme.test/lead",
        status: reply.status ?? 200,
        reply,
      },
    ],
    ...extra,
  });

test("htmlToText drops scripts and keeps inline phrases on one line", () => {
  const t = htmlToText(
    '<script>var x="Thanks, we received your message"</script><p>Your <b>message</b> has been <i>sent</i>.</p>',
  );
  assert.equal(t, "Your message has been sent.");
});

test("a confirmation phrase already in the pre-submit HTML (hidden) is not the server's new answer", () => {
  const o = withReply(
    {
      body: "<div hidden>Thanks, we received your message</div>",
      finalUrl: base0.finalUrl,
      redirected: false,
    },
    {
      htmlBefore:
        "<html><body><div hidden>Thanks, we received your message</div></body></html>",
    },
  );
  assert.equal(o.status, "unconfirmed");
});

test("a server answer that carries an error cue beside the phrase is not accepted", () => {
  const o = withReply({
    body: "<p>Thanks, we received your message but it could not be saved</p>",
    finalUrl: base0.finalUrl,
    redirected: false,
  });
  assert.notEqual(o.status, "accepted");
});

test("a redirect whose final address is a plain article is never accepted, even with the phrase in its body", () => {
  const o = withReply({
    body: "<p>Your message has been sent.</p>",
    finalUrl: "https://acme.test/blog/post",
    redirected: true,
  });
  assert.equal(o.status, "unconfirmed");
});

test("JSON status 'success' is server evidence like ok:true", () => {
  const o = classifyOutcome({
    ...base0,
    relevant: [
      {
        method: "POST",
        url: "https://acme.test/lead",
        status: 200,
        contentType: "application/json",
        body: '{"status":"success"}',
      },
    ],
  });
  assert.equal(o.status, "accepted");
});
