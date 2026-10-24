// Read-only crawl + inventory + checks. Never submits, clicks or types anything.
import { chromium } from "playwright";
import { extractPage } from "./extract.js";
import { CHAT_VENDORS, hostKey } from "./rules.js";
import { buildInventory } from "./inventory.js";
import { deriveFindings } from "./findings.js";
import { computeScore } from "./score.js";
import { fetchRobots, checkLink, checkMx, USER_AGENT } from "./net.js";

export const VERSION = "1.0.0";
const SKIP_EXT =
  /\.(?:pdf|jpe?g|png|gif|webp|svg|ico|zip|rar|7z|mp4|mov|mp3|wav|css|js|json|xml|txt|docx?|xlsx?|pptx?|woff2?|ttf)(?:[?#]|$)/i;
const PRIORITY =
  /contact|quote|book|appointment|enquir|inquir|get-in-touch|reach|support|demo|schedule|consult|whatsapp|chat|pricing|services|about/i;

export const MOBILE_CONTEXT = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 lead-leak-audit/${VERSION}`,
};

export function normalizeUrl(input) {
  let s = String(input).trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  u.hash = "";
  return u;
}

function canonical(u) {
  const c = new URL(u.href);
  c.hash = "";
  if (c.pathname.length > 1) c.pathname = c.pathname.replace(/\/+$/, "");
  return c.href;
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

export async function launchBrowser(opts = {}) {
  return chromium.launch({ headless: !opts.headed });
}

/**
 * @returns {Promise<{meta, inventory, findings, score, pagesCrawled}>}
 */
export async function scan(startUrl, opts = {}) {
  const {
    maxPages = 15,
    settleMs = 2500,
    timeoutMs = 20000,
    linkCheck = true,
    mxCheck = true,
    log = () => {},
    fetchImpl = fetch,
    resolver,
  } = opts;
  const start = normalizeUrl(startUrl);
  const origin = start.origin;
  const t0 = Date.now();
  const robots = await fetchRobots(origin, fetchImpl);
  const ownBrowser = !opts.browser;
  const browser = opts.browser || (await launchBrowser(opts));
  const chatSelectors = Object.fromEntries(
    CHAT_VENDORS.map((v) => [v.vendor, v.dom]),
  );
  const queue = [canonical(start)];
  const seen = new Set(queue);
  const pages = [];
  const skippedByRobots = [];

  const context = await browser.newContext(MOBILE_CONTEXT);
  try {
    while (queue.length && pages.length < maxPages) {
      const url = queue.shift();
      if (!robots.isAllowed(new URL(url).pathname + new URL(url).search)) {
        skippedByRobots.push(url);
        continue;
      }
      log(`scan ${pages.length + 1}/${maxPages} ${url}`);
      const page = await context.newPage();
      const consoleMessages = [];
      const failedRequests = [];
      page.on("console", (m) => {
        if (m.type() === "error")
          consoleMessages.push({
            kind: "console",
            type: "error",
            text: m.text(),
          });
      });
      page.on("pageerror", (e) =>
        consoleMessages.push({
          kind: "pageerror",
          type: "error",
          text: String(e.message || e),
        }),
      );
      page.on("requestfailed", (r) =>
        failedRequests.push({
          url: r.url(),
          status: 0,
          error: r.failure()?.errorText || "failed",
        }),
      );
      page.on("response", (r) => {
        if (r.status() >= 400)
          failedRequests.push({ url: r.url(), status: r.status() });
      });
      const rec = {
        url,
        status: 0,
        extract: null,
        consoleMessages,
        failedRequests,
        error: null,
      };
      try {
        const res = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });
        rec.status = res ? res.status() : 0;
        await page
          .waitForLoadState("load", { timeout: Math.min(timeoutMs, 10000) })
          .catch(() => {});
        await page.waitForTimeout(settleMs);
        rec.extract = await page.evaluate(extractPage, { chatSelectors });
        rec.url = canonical(new URL(page.url()));
        const landed = new URL(page.url());
        if (!robots.isAllowed(landed.pathname + landed.search)) {
          rec.error = `redirected to a path robots.txt disallows (${landed.pathname})`;
          rec.extract = null;
        }
        if (hostKey(new URL(page.url()).host) !== hostKey(start.host)) {
          rec.error = `redirected off-site to ${new URL(page.url()).host}`;
          rec.extract = null;
        }
      } catch (err) {
        rec.error = String(err.message || err).split("\n")[0];
      } finally {
        await page.close().catch(() => {});
      }
      pages.push(rec);
      seen.add(rec.url);
      if (!rec.extract) continue;
      const found = [];
      for (const a of rec.extract.anchors) {
        let u;
        try {
          u = new URL(a.href);
        } catch {
          continue;
        }
        if (
          !/^https?:$/.test(u.protocol) ||
          hostKey(u.host) !== hostKey(start.host) ||
          SKIP_EXT.test(u.pathname + u.search)
        )
          continue;
        const c = canonical(u);
        if (!seen.has(c)) {
          seen.add(c);
          found.push(c);
        }
      }
      found.sort((a, b) => Number(PRIORITY.test(b)) - Number(PRIORITY.test(a)));
      queue.push(...found);
    }
  } finally {
    await context.close().catch(() => {});
    if (ownBrowser) await browser.close().catch(() => {});
  }

  if (!pages.length || !pages[0].extract) {
    throw new Error(
      `Could not load ${start.href}${pages[0]?.error ? ": " + pages[0].error : ""}`,
    );
  }

  const inventory = buildInventory(pages);

  // Network checks (read-only: HEAD/GET and DNS).
  const checks = { links: {}, mx: {}, actions: {} };
  if (linkCheck) {
    const urls = [
      ...inventory.whatsapp
        .filter((w) => w.analysis.valid && /^https?:/i.test(w.href))
        .map((w) => w.href),
      ...inventory.booking.filter((b) => !b.embedded).map((b) => b.href),
    ];
    const results = await pool(urls, 4, (u) => checkLink(u, { fetchImpl }));
    urls.forEach((u, i) => {
      checks.links[u] = results[i];
    });
  }
  if (mxCheck) {
    const domains = [
      ...new Set(
        inventory.mailto
          .filter((m) => m.analysis.valid)
          .map((m) => m.analysis.domain),
      ),
    ];
    const results = await pool(domains, 4, (d) => checkMx(d, resolver));
    domains.forEach((d, i) => {
      checks.mx[d] = results[i];
    });
  }
  const actionUrls = [
    ...new Set(
      inventory.forms
        .filter(
          (f) =>
            (f.kind === "contact" || f.kind === "newsletter") &&
            f.actionAttr &&
            f.actionAttr !== "#" &&
            !/^javascript:/i.test(f.actionAttr) &&
            /^https?:/i.test(f.actionAbs),
        )
        .map((f) => f.actionAbs),
    ),
  ];
  const actionResults = await pool(actionUrls, 4, async (u) => {
    try {
      const res = await fetchImpl(u, {
        method: "HEAD",
        redirect: "follow",
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });
      return { status: res.status };
    } catch (err) {
      return { status: 0, error: String(err?.cause?.code || err?.name || err) };
    }
  });
  actionUrls.forEach((u, i) => {
    checks.actions[u] = actionResults[i];
  });

  const findings = deriveFindings(inventory, checks, { origin });
  const score = computeScore(findings);
  return {
    meta: {
      tool: "lead-leak-audit",
      version: VERSION,
      mode: "scan",
      url: start.href,
      origin,
      startedAt: new Date(t0).toISOString(),
      durationMs: Date.now() - t0,
      pagesCrawled: pages.length,
      maxPages,
      skippedByRobots,
      robotsRules: robots.rules,
      linkCheck,
      mxCheck,
    },
    inventory,
    checks,
    findings,
    score,
  };
}

/** Recompute findings/score after submit/reply results were appended. */
export function rescore(result, extraFindings) {
  const base = deriveFindings(result.inventory, result.checks, {
    origin: result.meta.origin,
  });
  const findings = [...base, ...extraFindings].map((f, i) => ({
    ...f,
    n: i + 1,
  }));
  return { ...result, findings, score: computeScore(findings) };
}
