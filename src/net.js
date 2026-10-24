// Small network helpers: robots.txt, link resolution, MX lookup. All read-only (GET/HEAD only).
import dns from "node:dns/promises";

export const USER_AGENT =
  "lead-leak-audit/1.0 (+https://github.com/waseemnasir2k26/lead-leak-audit)";

/** Parse robots.txt into a matcher for our user agent. */
export function parseRobots(text, agent = "lead-leak-audit") {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const lineRaw of String(text || "").split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "disallow" || key === "allow") && cur) {
      cur.rules.push({ allow: key === "allow", path: val });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)),
  );
  const chosen = mine.length
    ? mine
    : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules).filter((r) => r.path !== "");
  const toRe = (p) =>
    new RegExp(
      "^" +
        p
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\\\$$/, "$"),
    );
  const compiled = rules.map((r) => ({
    allow: r.allow,
    len: r.path.length,
    re: toRe(r.path),
  }));
  return {
    rules: compiled.length,
    isAllowed(pathname) {
      let best = null;
      for (const r of compiled) {
        if (
          r.re.test(pathname) &&
          (!best || r.len > best.len || (r.len === best.len && r.allow))
        )
          best = r;
      }
      return best ? best.allow : true;
    },
  };
}

export async function fetchRobots(origin, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(new URL("/robots.txt", origin), {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) return parseRobots("");
    return parseRobots(await res.text());
  } catch {
    return parseRobots(""); // no robots.txt reachable: nothing is disallowed
  }
}

/**
 * Check that a URL resolves. HEAD first, GET fallback. 401/403/429/999 are "inconclusive" because
 * many vendors block bots; they are reported but not counted as dead.
 */
export async function checkLink(url, { fetchImpl = fetch, timeoutMs = 10000, allowHost = null, lookup } = {}) {
  // Every hop (including redirects) is checked: a public link must not be able to bounce us to 169.254.x.x or localhost.
  const attempt = async (method) => {
    let target = url;
    for (let hop = 0; hop < 6; hop++) {
      const host = new URL(target).host;
      if (host !== allowHost && (await isPrivateTarget(target, lookup))) {
        const err = new Error('skipped: private, loopback or link-local address');
        err.code = 'PRIVATE_TARGET';
        throw err;
      }
      const res = await fetchImpl(target, { method, redirect: 'manual', headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' }, signal: AbortSignal.timeout(timeoutMs) });
      try { await res.body?.cancel(); } catch { /* ignore */ }
      const loc = res.headers?.get?.('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        target = new URL(loc, target).href;
        continue;
      }
      return { status: res.status, url: target };
    }
    return { status: 310, url: target }; // too many redirects
  };
  try {
    let res = await attempt('HEAD');
    if (res.status >= 400) res = await attempt('GET').catch(() => res);
    const status = res.status;
    const inconclusive = [401, 403, 429, 999].includes(status);
    return { url, status, finalUrl: res.url, ok: status < 400, inconclusive: !(status < 400) && inconclusive, error: null };
  } catch (err) {
    if (err.code === 'PRIVATE_TARGET') return { url, status: 0, finalUrl: null, ok: false, inconclusive: true, skipped: true, error: err.message };
    return { url, status: 0, finalUrl: null, ok: false, inconclusive: false, error: String(err?.cause?.code || err?.name || err?.message || err) };
  }
}

/** Does this email domain have somewhere to deliver mail? MX, else A/AAAA fallback (RFC 5321). */
export async function checkMx(domain, resolver = dns) {
  try {
    const mx = await resolver.resolveMx(domain);
    if (mx && mx.length) return { ok: true, records: mx.length };
  } catch (err) {
    if (err?.code && !["ENODATA", "ENOTFOUND", "ENOENT"].includes(err.code))
      return { ok: null, error: err.code }; // lookup trouble, not proof
  }
  try {
    const a = await resolver.resolve4(domain);
    if (a && a.length) return { ok: true, records: 0, fallback: "A" };
  } catch {
    /* fall through */
  }
  try {
    const a = await resolver.resolve6(domain);
    if (a && a.length) return { ok: true, records: 0, fallback: "AAAA" };
  } catch {
    /* fall through */
  }
  return { ok: false };
}

/** True for loopback, private, link-local and unspecified IP literals (v4 and v6). */
export function isPrivateIp(ip) {
  const s = String(ip).toLowerCase().replace(/^\[|\]$/g, '');
  const m4 = s.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m4) {
    const [a, b] = [Number(m4[1]), Number(m4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (s.includes(':')) return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
  return false;
}

/**
 * Would requesting this URL touch a private, loopback or link-local address?
 * Checks IP literals, "localhost"-style names, and what the hostname resolves to.
 * Lookup failures are treated as not private (the request itself will fail).
 */
export async function isPrivateTarget(url, lookup = dns.lookup.bind(dns)) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return true;
  }
  if (/^localhost$|\.localhost$|\.local$|\.internal$|\.lan$/i.test(host)) return true;
  if (isPrivateIp(host)) return true;
  if (/^[\d.]+$/.test(host) || host.includes(':')) return false; // public literal
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.some((a) => isPrivateIp(a.address));
  } catch {
    return false;
  }
}
