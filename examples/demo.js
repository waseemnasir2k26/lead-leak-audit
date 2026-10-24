// `npm run demo`: serve the fixture site, run scan + submit against it, write a report.
// Local only: link and DNS checks are off, and nothing leaves your machine.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDemoServer } from "./demo-site/server.js";
import { runSubmit, writeReports } from "../src/run.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", "reports", "demo");
const saveSample = process.argv.includes("--sample");

let site;
try {
  site = await startDemoServer({ port: 4173 }).catch(() =>
    startDemoServer({ port: 0 }),
  );
  console.log(`Demo site: ${site.url}`);
  const { result, extra } = await runSubmit(site.url, {
    iOwn: true,
    confirm: async () => true, // local fixture site: no human needed
    email: "inbox@example.test",
    linkCheck: false,
    mxCheck: false,
    settleMs: 800,
    log: (m) => console.log(`  ${m}`),
  });
  const { report, htmlPath } = writeReports(result, outDir, extra);
  console.log(
    `\nLead survival score: ${report.score.value}/100 (${report.score.grade})`,
  );
  for (const f of report.findings
    .filter((x) => x.severity !== "info")
    .slice(0, 8))
    console.log(`  [${f.severity}] ${f.title}`);
  const never = extra.submissions.filter((s) => s.status === "skipped");
  console.log(
    `\nForms it refused to submit: ${never.length} (${never.map((s) => s.kind).join(", ")})`,
  );
  console.log(`Leads the demo server actually received: ${site.leads.length}`);
  console.log(`Report: ${htmlPath}`);
  if (saveSample) {
    const dest = path.join(here, "sample-report.html");
    fs.copyFileSync(htmlPath, dest);
    console.log(`Saved sample: ${dest}`);
  }
} finally {
  await site?.close();
}
