// Credential handling. IMAP details come from env vars only and must never reach a file or a log line.

export const SECRET_ENV_VARS = [
  "LLA_IMAP_HOST",
  "LLA_IMAP_USER",
  "LLA_IMAP_PASS",
];

/** Read IMAP config from env. Returns null when not fully configured. */
export function imapConfigFromEnv(env = process.env) {
  const host = env.LLA_IMAP_HOST;
  const user = env.LLA_IMAP_USER;
  const pass = env.LLA_IMAP_PASS;
  if (!host || !user || !pass) return null;
  return {
    host,
    user,
    pass,
    port: Number(env.LLA_IMAP_PORT) || 993,
    secure: env.LLA_IMAP_SECURE !== "false",
  };
}

/** Values that must never appear in output. Short values (<4 chars) are ignored to avoid wrecking text. */
export function collectSecrets(env = process.env) {
  return SECRET_ENV_VARS.map((k) => env[k]).filter(
    (v) => typeof v === "string" && v.length >= 4,
  );
}

const PATTERNS = [
  [
    /(pass(?:word)?|pwd|secret|api[-_]?key)(["']?\s*[:=]\s*["']?)([^\s"'&,;]{3,})/gi,
    "$1$2[REDACTED]",
  ],
  [/(LLA_IMAP_(?:USER|PASS|HOST)\s*=\s*)\S+/g, "$1[REDACTED]"],
  [/(Authorization:\s*(?:Basic|Bearer)\s+)\S+/gi, "$1[REDACTED]"],
];

export function redactString(str, secrets = collectSecrets()) {
  let out = String(str);
  for (const s of secrets) {
    if (!s) continue;
    out = out.split(s).join("[REDACTED]");
  }
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Deep-copy a JSON-able value with every string redacted. */
export function redactDeep(value, secrets = collectSecrets()) {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /^(pass|password|secret|imapPass|apiKey)$/i.test(k)
        ? "[REDACTED]"
        : redactDeep(v, secrets);
    }
    return out;
  }
  return value;
}

export function maskEmail(email) {
  const s = String(email || "");
  const at = s.indexOf("@");
  if (at < 1) return s ? "***" : "";
  return `${s[0]}***${s.slice(at)}`;
}

/** Throw if any secret survived into serialized output. Used as a last guard before writing files. */
export function assertNoSecrets(text, secrets = collectSecrets()) {
  for (const s of secrets) {
    if (s && text.includes(s))
      throw new Error(
        "Refusing to write output: a credential value was found in the report.",
      );
  }
}
