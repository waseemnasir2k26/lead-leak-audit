export { scan, rescore, VERSION } from "./scan.js";
export { runScan, runSubmit, ciVerdict, readBaselineScore } from "./run.js";
export {
  checkRails,
  planSubmissions,
  planForm,
  classifyOutcome,
  valueFor,
  RailError,
} from "./submit.js";
export {
  analyzeTel,
  analyzeMailto,
  analyzeWhatsApp,
  detectChatVendors,
  detectCaptcha,
} from "./rules.js";
export { computeScore, speedBucket } from "./score.js";
export { buildReport, renderHtml, writeReports } from "./report.js";
export { waitForReplies } from "./imap.js";
export { redactDeep, redactString } from "./redact.js";
