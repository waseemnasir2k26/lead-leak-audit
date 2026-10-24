// Lead survival score. Start at 100, subtract a penalty per leak. Info items never cost points.

export const PENALTY = { critical: 25, high: 15, medium: 8, low: 3, info: 0 };
export const CATEGORY_CAP = 40;
export const SEVERITIES = ["critical", "high", "medium", "low", "info"];

export const CATEGORIES = {
  forms: "Contact forms",
  email: "Email and phone links",
  whatsapp: "WhatsApp",
  chat: "Chat widgets",
  booking: "Booking links",
  mobile: "Mobile experience",
  speed: "Reply speed",
  coverage: "Lead path coverage",
};

export function grade(score) {
  if (score >= 90) return { label: "Healthy", tone: "good" };
  if (score >= 70) return { label: "Leaky", tone: "warn" };
  if (score >= 40) return { label: "Bleeding", tone: "bad" };
  return { label: "Critical", tone: "critical" };
}

/**
 * @param {Array<{severity:string, category:string}>} findings
 * @returns {{score:number, grade:object, penalty:number, bySeverity:object, byCategory:object}}
 */
export function computeScore(findings) {
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  const byCategory = {};
  let penalty = 0;
  for (const f of findings) {
    const p = PENALTY[f.severity] ?? 0;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    penalty += p;
    const c = (byCategory[f.category] ||= {
      label: CATEGORIES[f.category] || f.category,
      penalty: 0,
      findings: 0,
    });
    c.penalty += p;
    c.findings += 1;
  }
  // One badly broken area should not zero the whole score: each category loses at most CATEGORY_CAP.
  penalty = 0;
  for (const c of Object.values(byCategory)) {
    c.lost = Math.min(c.penalty, CATEGORY_CAP);
    c.score = 100 - c.lost;
    penalty += c.lost;
  }
  const score = Math.max(0, Math.min(100, 100 - penalty));
  return { score, grade: grade(score), penalty, bySeverity, byCategory };
}

/** Speed-to-lead buckets from seconds (null = no reply seen). */
export function speedBucket(seconds) {
  if (seconds === null || seconds === undefined)
    return { bucket: "dead", label: "No reply", severity: "critical" };
  if (seconds < 300)
    return { bucket: "great", label: "Under 5 minutes", severity: null };
  if (seconds < 3600)
    return { bucket: "ok", label: "Under 1 hour", severity: "low" };
  return { bucket: "leak", label: "Over 1 hour", severity: "high" };
}
