// Human confirmation: show exactly what would be sent, then ask. Nothing is sent without a "y".
import readline from "node:readline";
import { maskEmail } from "./redact.js";

const clip = (s, n = 70) => {
  const t = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Multi-line, human-readable plan: per form the page, heading, button, fields and the verdict with its reason. */
export function formatPlan(plan, { email } = {}) {
  const lines = [];
  const send = plan.filter(
    (p) => p.status === "would-submit" || p.status === "planned",
  );
  lines.push(
    `Submission plan: ${send.length} form(s) would be submitted, ${plan.length - send.length} will not be.`,
  );
  if (email) lines.push(`Test inbox: ${maskEmail(email)}`);
  lines.push("");
  for (const p of plan) {
    const verdict =
      p.status === "would-submit" || p.status === "planned"
        ? "WILL SUBMIT"
        : `will NOT submit (${p.status})`;
    lines.push(`#${p.index} ${verdict}`);
    lines.push(`    page:    ${p.page}`);
    if (p.heading) lines.push(`    heading: ${clip(p.heading)}`);
    if (p.submitText) lines.push(`    button:  ${clip(p.submitText, 40)}`);
    if (p.kind) lines.push(`    kind:    ${p.kind}`);
    if (p.reason) lines.push(`    reason:  ${clip(p.reason, 200)}`);
    if (p.fields?.length)
      lines.push(
        `    fields:  ${p.fields.map((f) => `${f.field}=${JSON.stringify(clip(f.value, 40))}`).join(", ")}`,
      );
    if (p.skippedFields?.length)
      lines.push(`    left empty: ${p.skippedFields.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Ask a y/N question on the terminal. Resolves false on anything but y/yes. Needs a TTY. */
export function askYesNo(
  question,
  { input = process.stdin, output = process.stderr } = {},
) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(String(answer).trim()));
    });
  });
}
