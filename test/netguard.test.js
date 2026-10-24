import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  isPrivateIp,
  isPrivateLiteral,
  isPrivateTarget,
  parseIPv4Loose,
  expandIPv6,
  makeGuardedLookup,
  safeRequest,
  checkLink,
} from "../src/netguard.js";
import { bookingVendor } from "../src/rules.js";

const host = (u) => new URL(u).hostname; // what WHATWG URL normalises it to

test("IPv6 expansion handles ::, embedded IPv4 and zones", () => {
  assert.deepEqual(expandIPv6("::1"), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(
    expandIPv6("::ffff:127.0.0.1"),
    [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1],
  );
  assert.deepEqual(expandIPv6("[fe80::1%eth0]"), [0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  assert.equal(expandIPv6("not-an-ip"), null);
  assert.equal(expandIPv6("1:2:3"), null);
});

test("IPv4 in decimal, octal, hex and short forms", () => {
  assert.equal(parseIPv4Loose("127.0.0.1"), 0x7f000001);
  assert.equal(parseIPv4Loose("2130706433"), 0x7f000001);
  assert.equal(parseIPv4Loose("0x7f.1"), 0x7f000001);
  assert.equal(parseIPv4Loose("0177.0.0.1"), 0x7f000001);
  assert.equal(parseIPv4Loose("127.1"), 0x7f000001);
  assert.equal(parseIPv4Loose("example.com"), null);
  assert.equal(parseIPv4Loose("256.1.1.1"), null);
});

const PRIVATE = [
  "127.0.0.1",
  "127.255.255.254",
  "0.0.0.0",
  "0.1.2.3",
  "10.0.0.1",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.0.1",
  "169.254.169.254",
  "100.64.0.1",
  "100.127.255.255",
  "192.0.0.1",
  "198.18.0.1",
  "224.0.0.1",
  "255.255.255.255",
  "2130706433",
  "0x7f.1",
  "017700000001",
  "127.1",
  "0xa9fea9fe",
  "::",
  "::1",
  "[::1]",
  "::ffff:7f00:1",
  "[::ffff:7f00:1]",
  "::ffff:a9fe:a9fe",
  "[::ffff:a9fe:a9fe]",
  "::ffff:127.0.0.1",
  "::7f00:1",
  "[::7f00:1]",
  "::a9fe:a9fe",
  "::ffff:0:0",
  "fc00::1",
  "fd12:3456::1",
  "fdff:ffff::1",
  "fe80::1",
  "febf::1",
  "fe80::1%eth0",
  "fec0::1",
  "ff02::1",
  "2001:db8::1",
  "2002:7f00:1::1",
  "64:ff9b::7f00:1",
  "2001:0:4136:e378::1",
  "garbage:::",
];
const PUBLIC = [
  "8.8.8.8",
  "1.1.1.1",
  "172.32.0.1",
  "172.15.255.255",
  "100.63.255.255",
  "100.128.0.1",
  "93.184.216.34",
  "2606:4700:4700::1111",
  "::ffff:8.8.8.8",
  "::ffff:808:808",
  "2002:808:808::1",
  "example.com",
  "calendly.com",
];

for (const ip of PRIVATE)
  test(`private: ${ip}`, () => assert.equal(isPrivateIp(ip), true));
for (const ip of PUBLIC)
  test(`public: ${ip}`, () => assert.equal(isPrivateIp(ip), false));

test("URLs are judged after WHATWG normalisation", () => {
  for (const u of [
    "http://2130706433/",
    "http://0x7f.1/",
    "http://017700000001/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[::7f00:1]/",
    "http://[fd00::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost/",
    "http://printer.local/",
    "http://[::1]:8080/",
  ]) {
    assert.equal(isPrivateLiteral(u), true, `${u} -> ${host(u)}`);
  }
  for (const u of [
    "https://calendly.com/x",
    "https://8.8.8.8/",
    "http://[2606:4700:4700::1111]/",
  ])
    assert.equal(isPrivateLiteral(u), false, u);
});

test("isPrivateTarget also resolves names", async () => {
  assert.equal(
    await isPrivateTarget("https://rebind.example/x", async () => [
      { address: "10.0.0.5" },
    ]),
    true,
  );
  assert.equal(
    await isPrivateTarget("https://rebind.example/x", async () => [
      { address: "8.8.8.8" },
      { address: "::ffff:7f00:1" },
    ]),
    true,
  );
  assert.equal(
    await isPrivateTarget("https://ok.example/x", async () => [
      { address: "93.184.216.34" },
    ]),
    false,
  );
});

test("guarded lookup rejects a private answer and passes a public one (both callback shapes)", async () => {
  const fake = (addr) => (hostname, opts, cb) =>
    cb(null, [{ address: addr, family: addr.includes(":") ? 6 : 4 }]);
  const bad = makeGuardedLookup(fake("10.0.0.5"));
  await assert.rejects(
    new Promise((res, rej) =>
      bad("x.example", {}, (e, a) => (e ? rej(e) : res(a))),
    ),
    /private/,
  );
  const good = makeGuardedLookup(fake("93.184.216.34"));
  assert.deepEqual(
    await new Promise((res, rej) =>
      good("x.example", {}, (e, a, f) => (e ? rej(e) : res([a, f]))),
    ),
    ["93.184.216.34", 4],
  );
  assert.deepEqual(
    await new Promise((res, rej) =>
      good("x.example", { all: true }, (e, l) => (e ? rej(e) : res(l))),
    ),
    [{ address: "93.184.216.34", family: 4 }],
  );
  const allowed = makeGuardedLookup(fake("10.0.0.5"), { allowPrivate: true });
  assert.equal(
    await new Promise((res, rej) =>
      allowed("x.example", {}, (e, a) => (e ? rej(e) : res(a))),
    ),
    "10.0.0.5",
  );
});

test("DNS rebinding: the connection uses the one checked resolution, so a private answer never gets a socket", async () => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    res.end("secret");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  let lookups = 0;
  // A name that "was public" on a first check and is private on the real connection.
  const rebinding = (hostname, opts, cb) => {
    lookups++;
    cb(null, [
      { address: lookups === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 },
    ]);
  };
  try {
    // 1) a plain name whose only resolution is private: refused, server untouched
    await assert.rejects(
      safeRequest(`http://rebind.example:${port}/`, {
        lookup: (h, o, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }]),
      }),
      /private/,
    );
    // 2) the connection path performs exactly one lookup, and it is the guarded one
    lookups = 1; // pretend the "public" pre-check already happened; the connect-time answer is private
    await assert.rejects(
      safeRequest(`http://rebind.example:${port}/`, { lookup: rebinding }),
      /private/,
    );
    assert.equal(lookups, 2);
    assert.equal(hits, 0, "no request reached the private server");
    // 3) literals never reach DNS at all
    await assert.rejects(safeRequest(`http://127.0.0.1:${port}/`), /private/);
    await assert.rejects(
      safeRequest(`http://[::ffff:7f00:1]:${port}/`),
      /private/,
    );
    assert.equal(hits, 0);
    // 4) the scanned site itself may be private (demo / local use)
    const ok = await safeRequest(`http://127.0.0.1:${port}/`, {
      allowPrivate: true,
    });
    assert.equal(ok.status, 200);
    assert.equal(hits, 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("checkLink: private targets and redirect hops are never requested; own host is allowed", async () => {
  const seen = [];
  const requestImpl = async (u) => {
    seen.push(u);
    if (u.startsWith("https://public.example/"))
      return {
        status: 302,
        location: "http://[::ffff:a9fe:a9fe]/latest/meta-data",
      };
    return { status: 200, location: null };
  };
  const direct = await checkLink("http://169.254.169.254/latest", {
    requestImpl,
  });
  assert.equal(direct.skipped, true);
  assert.equal(direct.inconclusive, true);
  const hop = await checkLink("https://public.example/go", { requestImpl });
  assert.equal(hop.skipped, true);
  assert.deepEqual(
    seen,
    ["https://public.example/go"],
    "the private hop was never requested",
  );
  const own = await checkLink("http://127.0.0.1:4173/page", {
    requestImpl,
    allowHost: "127.0.0.1:4173",
  });
  assert.equal(own.ok, true);
});

test("GoHighLevel booking: only known hosts, or a /widget/booking path on the scanned site itself", () => {
  assert.equal(
    bookingVendor("https://app.leadconnectorhq.com/widget/booking/abc"),
    "GoHighLevel",
  );
  assert.equal(
    bookingVendor("https://link.msgsndr.com/widget/booking/abc"),
    "GoHighLevel",
  );
  assert.equal(bookingVendor("http://169.254.169.254/widget/booking/x"), null);
  assert.equal(bookingVendor("https://evil.example/widget/booking/x"), null);
  assert.equal(
    bookingVendor("https://book.acme.test/widget/booking/x", {
      ownHost: "book.acme.test",
    }),
    "GoHighLevel",
  );
  assert.equal(
    bookingVendor("https://other.acme.test/widget/booking/x", {
      ownHost: "book.acme.test",
    }),
    null,
  );
});
