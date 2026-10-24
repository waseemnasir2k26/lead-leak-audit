// Private-address guard. Everything that fetches a URL taken from page content goes through here.
import net from 'node:net';
import dns from 'node:dns/promises';
import dnsCb from 'node:dns';
import http from 'node:http';
import https from 'node:https';

export const USER_AGENT = 'lead-leak-audit/1.0 (+https://github.com/waseemnasir2k26/lead-leak-audit)';

/** inet_aton-style IPv4 parsing: 1-4 parts, each decimal, 0octal or 0xhex. Returns a uint32 or null. */
export function parseIPv4Loose(str) {
  const parts = String(str).split('.');
  if (parts.length < 1 || parts.length > 4 || parts.some((p) => p === '')) return null;
  const nums = [];
  for (const p of parts) {
    let n;
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^(?:0|[1-9]\d*)$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  const last = nums.pop();
  if (nums.some((n) => n > 255)) return null;
  if (last >= 256 ** (4 - nums.length)) return null;
  let v = last;
  nums.forEach((n, idx) => {
    v += n * 256 ** (3 - idx);
  });
  return v >>> 0;
}

/** Expand an IPv6 literal (with ::, optional embedded dotted IPv4, optional zone) to 8 16-bit groups, or null. */
export function expandIPv6(input) {
  let s = String(input).trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (net.isIP(s) !== 6) return null;
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v = parseIPv4Loose(dotted[1]);
    if (v === null) return null;
    s = s.slice(0, -dotted[1].length) + (v >>> 16).toString(16) + ':' + (v & 0xffff).toString(16);
  }
  let head = s;
  let tail = '';
  if (s.includes('::')) [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const missing = 8 - h.length - t.length;
  if (!s.includes('::') && missing !== 0) return null;
  const groups = [...h, ...Array(Math.max(0, missing)).fill('0'), ...t].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function v4Private(n) {
  const a = n >>> 24;
  const b = (n >>> 16) & 255;
  const c = (n >>> 8) & 255;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/**
 * True for loopback, private, link-local, unspecified, shared (CGNAT), documentation and multicast
 * addresses, in every spelling: dotted/decimal/octal/hex IPv4, IPv6, IPv4-mapped (::ffff:7f00:1),
 * IPv4-compatible (::7f00:1), NAT64 and 6to4. An unparseable IPv6 literal counts as private (fail closed).
 * A hostname (not an IP literal) returns false.
 */
export function isPrivateIp(ip) {
  const s = String(ip).trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!s.includes(':')) {
    const v = parseIPv4Loose(s);
    return v === null ? false : v4Private(v);
  }
  const g = expandIPv6(s);
  if (!g) return true;
  const v4 = (hi, lo) => ((hi << 16) | lo) >>> 0;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Private(v4(g[6], g[7])); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return v4Private(v4(g[6], g[7])); // ::a.b.c.d (includes ::1)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4Private(v4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return v4Private(v4(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

const LOCAL_NAMES = /^localhost$|\.localhost$|\.local$|\.internal$|\.lan$|\.home\.arpa$/i;

/** Literal check only (no DNS): IP literals in any spelling and local-looking names. */
export function isPrivateLiteral(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return true;
  }
  return LOCAL_NAMES.test(host) || isPrivateIp(host);
}

/** Literal check plus what the name currently resolves to. Lookup failures are "not private" (the request itself fails). */
export async function isPrivateTarget(url, lookup = dns.lookup.bind(dns)) {
  if (isPrivateLiteral(url)) return true;
  let host;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return true;
  }
  if (net.isIP(host) || parseIPv4Loose(host) !== null) return false;
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.some((a) => isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/**
 * dns.lookup replacement for http(s).request. The check runs on the very addresses the socket will
 * connect to, so a name cannot resolve to a public IP for a pre-check and a private IP for the connection
 * (DNS rebinding): there is exactly one resolution and it is the one that is used.
 */
export function makeGuardedLookup(realLookup = dnsCb.lookup, { allowPrivate = false } = {}) {
  return (hostname, options, cb) => {
    if (typeof options === 'function') {
      cb = options;
      options = {};
    }
    realLookup(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) return cb(err);
      const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: net.isIP(addrs) }];
      if (!allowPrivate && list.some((a) => isPrivateIp(a.address))) {
        const e = new Error('skipped: private, loopback or link-local address');
        e.code = 'PRIVATE_TARGET';
        return cb(e);
      }
      if (options && options.all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  };
}

function privateError() {
  const e = new Error('skipped: private, loopback or link-local address');
  e.code = 'PRIVATE_TARGET';
  return e;
}

/** One HTTP(S) request with a pinned, checked address. Does not follow redirects. Returns {status, location}. */
export function safeRequest(url, { method = 'HEAD', timeoutMs = 10000, allowPrivate = false, lookup } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(e);
    }
    if (!/^https?:$/.test(u.protocol)) return reject(new Error('unsupported protocol'));
    if (!allowPrivate && isPrivateLiteral(url)) return reject(privateError());
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      { method, agent: false, timeout: timeoutMs, lookup: makeGuardedLookup(lookup, { allowPrivate }), headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' } },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location || null });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Check that a URL resolves. HEAD first, GET fallback. 401/403/429/999 are "inconclusive" because
 * many vendors block bots. Every hop, including redirects, is checked against the private-address guard,
 * and connections go to the checked address (no second DNS lookup).
 */
export async function checkLink(url, { requestImpl = safeRequest, timeoutMs = 10000, allowHost = null, lookup } = {}) {
  const attempt = async (method) => {
    let target = url;
    for (let hop = 0; hop < 6; hop++) {
      const allowPrivate = allowHost !== null && new URL(target).host === allowHost;
      if (!allowPrivate && isPrivateLiteral(target)) throw privateError();
      const res = await requestImpl(target, { method, timeoutMs, allowPrivate, lookup });
      if (res.status >= 300 && res.status < 400 && res.location) {
        target = new URL(res.location, target).href;
        continue;
      }
      return { status: res.status, url: target };
    }
    return { status: 310, url: target };
  };
  try {
    let res = await attempt('HEAD');
    if (res.status >= 400) res = await attempt('GET').catch(() => res);
    const status = res.status;
    const inconclusive = [401, 403, 429, 999].includes(status);
    return { url, status, finalUrl: res.url, ok: status < 400, inconclusive: !(status < 400) && inconclusive, error: null };
  } catch (err) {
    if (err.code === 'PRIVATE_TARGET') return { url, status: 0, finalUrl: null, ok: false, inconclusive: true, skipped: true, error: err.message };
    return { url, status: 0, finalUrl: null, ok: false, inconclusive: false, error: String(err?.code || err?.cause?.code || err?.name || err?.message || err) };
  }
}
