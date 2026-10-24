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
export async function checkLink(
  url,
  { fetchImpl = fetch, timeoutMs = 10000 } = {},
) {
  const attempt = async (method) => {
    const res = await fetchImpl(url, {
      method,
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    return res;
  };
  try {
    let res = await attempt("HEAD");
    if (res.status >= 400 && res.status !== 404)
      res = await attempt("GET").catch(() => res);
    else if (res.status === 404) res = await attempt("GET").catch(() => res);
    const status = res.status;
    const inconclusive = [401, 403, 429, 999].includes(status);
    return {
      url,
      status,
      finalUrl: res.url,
      ok: status < 400,
      inconclusive: !(status < 400) && inconclusive,
      error: null,
    };
  } catch (err) {
    return {
      url,
      status: 0,
      finalUrl: null,
      ok: false,
      inconclusive: false,
      error: String(err?.cause?.code || err?.name || err?.message || err),
    };
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
