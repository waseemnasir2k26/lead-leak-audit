// Regenerates the "What it will never submit" table in README.md from a real dry run against the
// look-alike form fixtures. The "Why" column is the tool's literal output, not hand-written text.
//   node scripts/gen-readme-table.mjs          print the table
//   node scripts/gen-readme-table.mjs --write  replace the block between the table markers in README.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startVendorSite } from '../test/vendor-sites.js';
import { runSubmit } from '../src/run.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = await startVendorSite();
const { extra } = await runSubmit(site.url, { iOwn: true, email: 'inbox@example.test', dryRun: true, linkCheck: false, mxCheck: false, settleMs: 100, maxPages: 80 });
await site.close();

const key = (p) => p.page.replace(/^.*\/p\//, '');
const order = ['cf7', 'gravity', 'wpforms', 'elementor', 'hubspot', 'shopifyContact', 'ghl', 'booking', 'hubspotNL', 'shopifyNLfooter', 'shopifyCart', 'shopifyAdd', 'shopifyRecover', 'donation', 'donation2', 'donate3', 'job', 'jobNoFile', 'bookingCard', 'bookingCard2', 'reset', 'reset2', 'gdpr', 'gdpr2', 'forum', 'forum2', 'review', 'review2', 'testimonial', 'guestbook', 'rsvp', 'waitlist', 'webinar', 'report', 'refund', 'cancel', 'postcomment', 'reviews-page'];
const rows = new Map(extra.plan.map((p) => [key(p), p]));
const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const lines = ['| Form shape | Verdict | Why (literal dry-run output) |', '| --- | --- | --- |'];
for (const k of order) {
  const p = rows.get(k);
  if (!p) continue;
  const why = p.status === 'would-submit' ? `accepted: ${(p.positives || []).join('; ')}` : p.reason;
  lines.push(`| \`${k}\` | ${p.status === 'would-submit' ? 'submitted' : 'never'} | ${esc(why)} |`);
}
const table = lines.join('\n');
if (process.argv.includes('--write')) {
  const file = path.join(ROOT, 'README.md');
  const s = fs.readFileSync(file, 'utf8');
  const a = s.indexOf('<!-- table:start -->');
  const b = s.indexOf('<!-- table:end -->');
  if (a < 0 || b < 0) throw new Error('table markers not found in README.md');
  fs.writeFileSync(file, `${s.slice(0, a)}<!-- table:start -->\n${table}\n${s.slice(b)}`);
  console.log(`README.md updated (${lines.length - 2} rows)`);
} else console.log(table);
process.exit(0);
