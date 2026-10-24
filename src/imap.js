// Optional reply-timing: poll a test inbox for messages that carry the unique test ID.
// Credentials come from LLA_IMAP_HOST / LLA_IMAP_USER / LLA_IMAP_PASS only. They are never logged or written.
import { speedBucket } from "./score.js";

/** Make a raw RFC 822 message searchable: undo quoted-printable soft breaks and decode base64 blocks. */
export function searchableText(source) {
  const raw = Buffer.isBuffer(source)
    ? source.toString("latin1")
    : String(source);
  let text = raw.replace(/=\r?\n/g, "");
  const extra = [];
  const b64 = /(?:^[A-Za-z0-9+/]{60,76}={0,2}\r?\n){2,}[A-Za-z0-9+/]*={0,2}/gm;
  for (const m of raw.match(b64) || []) {
    try {
      extra.push(Buffer.from(m.replace(/\s+/g, ""), "base64").toString("utf8"));
    } catch {
      /* not base64 after all */
    }
  }
  return text + "\n" + extra.join("\n");
}

/** Real client adapter around imapflow (an optional dependency). */
export async function createImapClient(cfg) {
  let ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch {
    throw new Error(
      'Reply timing needs the optional package "imapflow". Install it with: npm install imapflow',
    );
  }
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
  await client.connect();
  return {
    async listMessages(since) {
      const lock = await client.getMailboxLock("INBOX");
      const out = [];
      try {
        for await (const msg of client.fetch(
          { since },
          { source: true, internalDate: true },
        )) {
          out.push({
            date: msg.internalDate,
            text: searchableText(msg.source.subarray(0, 300000)),
          });
        }
      } finally {
        lock.release();
      }
      return out;
    },
    async close() {
      await client.logout().catch(() => {});
    },
  };
}

/**
 * Poll until every lead has a reply or the wait budget ends.
 * @param leads [{leadId, label, page, submittedAt: ISO}]
 * @param client {listMessages(since): Promise<[{date: Date, text: string}]>, close()}
 */
export async function waitForReplies(
  leads,
  {
    client,
    waitMinutes = 15,
    pollMs = 20000,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    log = () => {},
  },
) {
  const startedAt = now();
  const deadline = startedAt + waitMinutes * 60000;
  const earliest = new Date(
    Math.min(...leads.map((l) => Date.parse(l.submittedAt))) - 60000,
  );
  const found = new Map();
  for (;;) {
    let msgs = [];
    try {
      msgs = await client.listMessages(earliest);
    } catch (e) {
      log(`imap poll failed: ${String(e.message || e).split("\n")[0]}`); // message only; never the config
    }
    for (const l of leads) {
      if (found.has(l.leadId)) continue;
      const sub = Date.parse(l.submittedAt);
      const hits = msgs
        .filter(
          (m) =>
            m.text.includes(l.leadId) &&
            new Date(m.date).getTime() >= sub - 2000,
        )
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      if (hits.length)
        found.set(
          l.leadId,
          Math.max(0, (new Date(hits[0].date).getTime() - sub) / 1000),
        );
    }
    if (found.size === leads.length || now() >= deadline) break;
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  }
  return leads.map((l) => {
    const seconds = found.has(l.leadId) ? found.get(l.leadId) : null;
    return {
      leadId: l.leadId,
      label: l.label,
      page: l.page,
      seconds,
      waitedMinutes: waitMinutes,
      ...speedBucket(seconds),
    };
  });
}
