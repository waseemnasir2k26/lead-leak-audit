// Fixtures with NEUTRAL names (/pageN, title "Welcome"): nothing in a URL or title hints at what a form is,
// so a pass or a fail comes from the form itself, never from the fixture's name.
import http from "node:http";

const contactForm = (action, extra = "", attrs = "") =>
  `<h2>Contact us</h2><form action="${action}" method="post" ${attrs}><input name="name" placeholder="Your name"><input type="email" name="email" placeholder="Email"><textarea name="message" placeholder="How can we help?"></textarea>${extra}<button type="submit">Send message</button></form>`;

export const PAGES = {
  // ---- look-alikes that must be rejected
  1: `<h2>Re: Best router for a small office</h2><form action="/post/ok" method="post"><input name="name" placeholder="Name"><input type="email" name="email" placeholder="Email"><textarea name="message" placeholder="Write your answer"></textarea><button type="submit">Send</button></form>`,
  2: `<h2>Contact us</h2><form action="/post/ok" method="post"><input name="name" placeholder="Name"><input type="email" name="email" placeholder="Email"><input type="number" name="sum" value="0"><label><input type="radio" name="pick" value="a"> $10</label><label><input type="radio" name="pick" value="b"> $25</label><textarea name="message" placeholder="How can we help?"></textarea><button type="submit">Send message</button></form>`,
  3: `<h2>Contact us</h2><form action="/post/ok" method="post"><input name="name" placeholder="Name"><input type="email" name="email" placeholder="Email"><select name="response"><option value="">Choose</option><option>Yes</option><option>No</option></select><textarea name="message" placeholder="How can we help?"></textarea><button type="submit">Send message</button></form>`,
  4: `<h2>Contact us</h2><form action="/post/ok" method="post"><input name="name" placeholder="Name"><input type="email" name="email" placeholder="Email"><input type="range" name="score" min="1" max="5"><textarea name="message" placeholder="How can we help?"></textarea><button type="submit">Send message</button></form>`,
  5: `<h2>Contact us</h2><form action="/post/ok" method="post"><input name="name" placeholder="Name"><input type="email" name="email" placeholder="Email"><input type="number" name="headcount"><textarea name="message" placeholder="How can we help?"></textarea><button type="submit">Send message</button></form>`,
  14: `<h2>Contact us</h2><form action="/post/ok" method="post"><input name="name" placeholder="Name"><input type="email" name="email" placeholder="Email"><textarea name="message" placeholder="How can we help?"></textarea><input type="hidden" name="cardnumber" value=""><input type="hidden" name="exp" value=""><button type="button">Next</button></form>`,
  // ---- the positive control and its variants
  6: contactForm(
    "/post/ok",
    '<input type="tel" name="phone" placeholder="Phone">',
  ),
  7: contactForm(
    "/post/ok",
    '<label>Leave this field blank<input name="extra"></label>',
  ),
  // ---- outcomes
  8: contactForm("/post/blank"),
  9: contactForm("/post/fatal"),
  10: contactForm("/post/plain"),
  11: contactForm("/post/redir302"),
  12: `<h2>Contact us</h2><form id="jf" action="/post/ok" method="post"><input name="name" placeholder="Name"><input type="email" name="email" placeholder="Email"><textarea name="message" placeholder="How can we help?"></textarea><button type="submit">Send message</button></form><script>document.getElementById('jf').addEventListener('submit',function(e){e.preventDefault();fetch('/post/ok',{method:'POST',body:new URLSearchParams(new FormData(this))}).then(function(){location.href='/cart'})})</script>`,
  13: contactForm("/post/meta"),
  // ---- frames
  15: `<h1>Welcome</h1><iframe src="/frame1" width="400" height="400"></iframe>`,
  16: `<h1>Welcome</h1><iframe src="__FOREIGN__/embed/typeform.com/to/abc" width="400" height="300"></iframe>`,
  // ---- a time trap: submitting within 2.5 s of load is silently swallowed
  18: `<h2>Contact us</h2><form id="tf" action="/post/ok" method="post"><input name="name" placeholder="Name"><input type="email" name="email" placeholder="Email"><textarea name="message" placeholder="How can we help?"></textarea><button type="submit">Send message</button></form><script>var t0=Date.now();document.getElementById('tf').addEventListener('submit',function(e){if(Date.now()-t0<2500){e.preventDefault();}})</script>`,
};
export const FRAME = contactForm("/post/frame");

export async function startNeutralSites() {
  const posts = []; // "path" of every POST, bodies kept in `bodies`
  const bodies = [];
  const gets = [];
  const foreignHits = [];
  let FOREIGN = "";
  const main = http.createServer((q, r) => {
    const u = new URL(q.url, "http://x");
    if (q.method === "POST") {
      let b = "";
      q.on("data", (c) => (b += c));
      q.on("end", () => {
        posts.push(u.pathname);
        bodies.push({
          path: u.pathname,
          body: Object.fromEntries(new URLSearchParams(b)),
        });
        const html = (x) => {
          r.writeHead(200, { "content-type": "text/html" });
          r.end(x);
        };
        if (u.pathname === "/post/blank") return html("");
        if (u.pathname === "/post/fatal")
          return html(
            "<b>Fatal error</b>: Uncaught Exception: SMTP connect() failed in /var/www/html/wp-content/plugins/forms/mail.php:88\nStack trace:\n#0 {main}",
          );
        if (u.pathname === "/post/plain") return html("<p>Welcome</p>");
        if (u.pathname === "/post/redir302") {
          r.writeHead(302, { location: `${FOREIGN}/after` });
          return r.end();
        }
        if (u.pathname === "/post/meta")
          return html(
            `<meta http-equiv="refresh" content="0;url=${FOREIGN}/meta">Thank you, we received your message`,
          );
        return html("<p>Thank you, we received your message</p>");
      });
      return;
    }
    gets.push(u.pathname);
    if (u.pathname === "/robots.txt") {
      r.writeHead(404);
      return r.end();
    }
    if (u.pathname === "/frame1") {
      r.writeHead(200, { "content-type": "text/html" });
      return r.end(`<title>Welcome</title>${FRAME}`);
    }
    const m = u.pathname.match(/^\/page(\d+)$/);
    if (m && PAGES[m[1]]) {
      r.writeHead(200, { "content-type": "text/html" });
      return r.end(
        `<title>Welcome</title>${PAGES[m[1]].replaceAll("__FOREIGN__", FOREIGN)}`,
      );
    }
    r.writeHead(200, { "content-type": "text/html" });
    r.end("<title>Welcome</title><h1>Welcome</h1>");
  });
  const foreign = http.createServer((q, r) => {
    foreignHits.push(`${q.method} ${q.url}`);
    r.writeHead(200, { "content-type": "text/html" });
    r.end("<title>Welcome</title><p>foreign</p>");
  });
  await new Promise((r) => foreign.listen(0, "127.0.0.1", r));
  FOREIGN = `http://127.0.0.1:${foreign.address().port}`;
  await new Promise((r) => main.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${main.address().port}/`,
    posts,
    bodies,
    gets,
    foreignHits,
    close: async () => {
      main.closeAllConnections?.();
      foreign.closeAllConnections?.();
      await new Promise((r) => main.close(r));
      await new Promise((r) => foreign.close(r));
    },
  };
}
