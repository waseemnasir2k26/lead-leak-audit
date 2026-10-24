// Tiny static server for the fixture site. Used by `npm run demo` and by the integration tests.
// Deliberate leaks live in the HTML: a form posting to a 404, a CAPTCHA form, a malformed WhatsApp
// number, a chat widget whose script never renders anything, and a script error next to a form.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const STATE_CHANGING = ["/wp-comments-post.php", "/cart/add", "/unsubscribe", "/subscribe", "/api/upload", "/account/delete", "/private/collect"];

const CRISP_STUB =
  "(function(){var d=document.createElement('div');d.className='crisp-client';d.style.cssText='position:fixed;right:12px;bottom:12px;width:56px;height:56px;border-radius:50%;background:#1972f5';(document.body||document.documentElement).appendChild(d)})();";

export function startDemoServer({ port = 0, host = "127.0.0.1", foreign = "http://foreign.invalid" } = {}) {
  const hits = []; // POSTs to endpoints an audit must never reach
  const leads = [];
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    requests.push(`${req.method} ${url.pathname}`);
    if (url.pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("User-agent: *\nDisallow: /private/\n");
    }
    if (STATE_CHANGING.includes(url.pathname)) {
      if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); return res.end(); }
      hits.push(url.pathname);
      res.writeHead(200); return res.end("ok");
    }
    if (url.pathname === "/api/lead") {
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        return res.end();
      }
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 1e5) req.destroy();
      });
      req.on("end", () => {
        leads.push(Object.fromEntries(new URLSearchParams(body)));
        res.writeHead(303, { location: "/thanks.html" });
        res.end();
      });
      return;
    }
    if (url.pathname.startsWith("/cdn/")) {
      res.writeHead(200, { "content-type": TYPES[".js"] });
      return res.end(
        url.pathname.includes("crisp")
          ? CRISP_STUB
          : "/* installed, renders nothing */",
      );
    }
    const rel =
      url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const file = path.join(ROOT, rel);
    if (
      !file.startsWith(ROOT) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile() ||
      rel === "server.js"
    ) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Not found");
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
    });
    if (req.method === "HEAD") return res.end();
    if (path.extname(file) === ".html") {
      return res.end(fs.readFileSync(file, "utf8").replaceAll("__FOREIGN__", foreign));
    }
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const { port: p } = server.address();
      resolve({
        server,
        url: `http://${host}:${p}/`,
        leads,
        hits,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
