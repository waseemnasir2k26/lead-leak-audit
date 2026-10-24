import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { waitForReplies, searchableText } from "../src/imap.js";
import {
  redactString,
  redactDeep,
  imapConfigFromEnv,
  maskEmail,
  assertNoSecrets,
  collectSecrets,
} from "../src/redact.js";
import {
  buildReport,
  renderHtml,
  writeReports,
  esc,
  FOOTER_TEXT,
} from "../src/report.js";
import { computeScore } from "../src/score.js";

test("imap: time-to-first-reply per lead, matched by unique ID, with a fake clock", async () => {
  const t0 = Date.parse("2026-10-24T10:00:00Z");
  let clock = t0 + 1000;
  const inbox = [
    {
      date: new Date(t0 + 90_000),
      text: "Hi LLA-aaaaaaaa thanks for your message",
    },
    { date: new Date(t0 + 4000_000), text: "late reply for LLA-bbbbbbbb" },
    { date: new Date(t0 + 5000), text: "unrelated newsletter" },
  ];
  const client = { listMessages: async () => inbox };
  const leads = ["aaaaaaaa", "bbbbbbbb", "cccccccc"].map((id) => ({
    leadId: `LLA-${id}`,
    label: id,
    page: "p",
    submittedAt: new Date(t0).toISOString(),
  }));
  const res = await waitForReplies(leads, {
    client,
    waitMinutes: 15,
    pollMs: 1000,
    now: () => clock,
    sleep: async (ms) => {
      clock += 600_000;
      void ms;
    },
  });
  assert.equal(res[0].seconds, 90);
  assert.equal(res[0].bucket, "great");
  assert.equal(res[1].seconds, 4000);
  assert.equal(res[1].bucket, "leak");
  assert.equal(res[2].seconds, null);
  assert.equal(res[2].bucket, "dead");
});

test("imap: ignores messages older than the submission", async () => {
  const t0 = Date.parse("2026-10-24T10:00:00Z");
  let clock = t0;
  const client = {
    listMessages: async () => [
      { date: new Date(t0 - 600_000), text: "old LLA-11111111" },
    ],
  };
  const [r] = await waitForReplies(
    [
      {
        leadId: "LLA-11111111",
        label: "x",
        page: "p",
        submittedAt: new Date(t0).toISOString(),
      },
    ],
    {
      client,
      waitMinutes: 1,
      now: () => clock,
      sleep: async () => {
        clock += 120_000;
      },
    },
  );
  assert.equal(r.seconds, null);
});

test("imap: finds the ID through quoted-printable soft breaks and base64 bodies", () => {
  assert.ok(
    searchableText("Test ID: LLA-ab=\r\ncd1234").includes("LLA-abcd1234"),
  );
  const b64 = Buffer.from("Reply quoting LLA-feedbeef ".repeat(6))
    .toString("base64")
    .replace(/(.{76})/g, "$1\n");
  assert.ok(
    searchableText(`Content-Transfer-Encoding: base64\n\n${b64}\n`).includes(
      "LLA-feedbeef",
    ),
  );
});

test("redaction: configured secrets and credential-looking strings never survive", () => {
  const secrets = ["hunter2-secret", "imap.mailhost.example"];
  assert.equal(
    redactString("login hunter2-secret at imap.mailhost.example", secrets),
    "login [REDACTED] at [REDACTED]",
  );
  assert.equal(redactString("password=abc123xyz", []), "password=[REDACTED]");
  assert.equal(
    redactString("LLA_IMAP_PASS=whatever", []),
    "LLA_IMAP_PASS=[REDACTED]",
  );
  assert.equal(
    redactString("Authorization: Bearer abcdef", []),
    "Authorization: Bearer [REDACTED]",
  );
  const deep = redactDeep(
    {
      a: ["x hunter2-secret"],
      pass: "p",
      nested: { password: "q", ok: "fine" },
    },
    secrets,
  );
  assert.deepEqual(deep, {
    a: ["x [REDACTED]"],
    pass: "[REDACTED]",
    nested: { password: "[REDACTED]", ok: "fine" },
  });
  assert.throws(
    () => assertNoSecrets("contains hunter2-secret", secrets),
    /credential/,
  );
  assert.equal(maskEmail("owner@acme.test"), "o***@acme.test");
});

test("redaction: IMAP config comes from env only", () => {
  assert.equal(imapConfigFromEnv({}), null);
  assert.equal(
    imapConfigFromEnv({ LLA_IMAP_HOST: "h", LLA_IMAP_USER: "u" }),
    null,
  );
  const cfg = imapConfigFromEnv({
    LLA_IMAP_HOST: "h.example",
    LLA_IMAP_USER: "u",
    LLA_IMAP_PASS: "p4ss-word",
  });
  assert.equal(cfg.port, 993);
  assert.deepEqual(
    collectSecrets({
      LLA_IMAP_HOST: "h.example",
      LLA_IMAP_USER: "user1",
      LLA_IMAP_PASS: "p4ss-word",
    }).sort(),
    ["h.example", "p4ss-word", "user1"],
  );
});

function sampleResult(over = {}) {
  const findings = [
    {
      n: 1,
      id: "x",
      severity: "critical",
      category: "forms",
      title: "Form <script>alert(1)</script> is broken",
      detail: 'detail "quoted" & more',
      fix: "Fix it",
      where: ["https://acme.test/contact"],
      evidence: "POST /a -> 404",
    },
    {
      n: 2,
      id: "y",
      severity: "info",
      category: "forms",
      title: "Info note",
      detail: "d",
      fix: "f",
      where: [],
    },
  ];
  return {
    meta: {
      version: "1.0.0",
      mode: "submit",
      url: "https://acme.test/",
      pagesCrawled: 3,
      maxPages: 15,
      durationMs: 1200,
      skippedByRobots: [],
      linkCheck: true,
      mxCheck: true,
    },
    inventory: {
      pages: [
        { url: "https://acme.test/", status: 200, title: "Home", forms: 1 },
      ],
      forms: [
        {
          kind: "contact",
          pages: ["https://acme.test/contact"],
          actionAbs: "https://acme.test/send",
          method: "post",
          required: 2,
          fields: [
            {
              name: "email",
              type: "email",
              required: true,
              visible: true,
              honeypot: false,
            },
          ],
          honeypots: [],
          captcha: { present: false },
          submit: { text: "Send", w: 100, h: 40 },
          visibleOnMobile: true,
        },
      ],
      mailto: [],
      tel: [],
      whatsapp: [],
      booking: [],
      chat: [],
    },
    findings,
    score: computeScore(findings),
    ...over,
  };
}

test("report: self-contained HTML, escapes site content, exact footer line, no external requests", () => {
  const report = buildReport(sampleResult(), {
    submissions: [
      {
        label: "contact",
        page: "https://acme.test/contact",
        status: "failed",
        detail: "HTTP 404",
      },
    ],
    email: "owner@acme.test",
  });
  const html = renderHtml(report);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(
    !html.includes("<script>alert(1)</script>"),
    "site-controlled text must be escaped",
  );
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(
    html.includes(
      'Report by lead-leak-audit (open source) · Want these leaks fixed? <a href="https://skynetjoe.com">https://skynetjoe.com</a>',
    ),
  );
  assert.equal(
    FOOTER_TEXT,
    "Report by lead-leak-audit (open source) · Want these leaks fixed? https://skynetjoe.com",
  );
  assert.ok(
    !/<script|<link[^>]+href=|src="http/i.test(html),
    "no scripts or external assets",
  );
  assert.ok(html.includes("Lead survival score"));
  assert.ok(html.includes("@media print"));
  assert.ok(html.includes("width=device-width"));
  assert.equal(report.testInbox, "o***@acme.test");
  assert.equal(report.score.value, 75);
});

test("report: credentials in the environment never reach report.json or report.html", () => {
  const prev = { ...process.env };
  process.env.LLA_IMAP_HOST = "imap.secret-host.example";
  process.env.LLA_IMAP_USER = "mailbox-user-9";
  process.env.LLA_IMAP_PASS = "sup3r-secret-pass";
  try {
    const result = sampleResult();
    result.findings[0].detail =
      "leaked sup3r-secret-pass and imap.secret-host.example and mailbox-user-9";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lla-report-"));
    const { jsonPath, htmlPath } = writeReports(result, dir, {
      email: "owner@acme.test",
    });
    for (const p of [jsonPath, htmlPath]) {
      const text = fs.readFileSync(p, "utf8");
      for (const s of [
        "sup3r-secret-pass",
        "imap.secret-host.example",
        "mailbox-user-9",
      ])
        assert.ok(!text.includes(s), `${s} leaked into ${path.basename(p)}`);
      assert.ok(text.includes("[REDACTED]"));
    }
    assert.ok(
      JSON.parse(fs.readFileSync(jsonPath, "utf8")).findings.length === 2,
    );
  } finally {
    for (const k of ["LLA_IMAP_HOST", "LLA_IMAP_USER", "LLA_IMAP_PASS"]) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});

test("report: esc handles quotes and ampersands", () => {
  assert.equal(
    esc('<a href="x">&\'</a>'),
    "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
  );
});
