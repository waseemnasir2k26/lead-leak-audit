# Weekly lead leak check in n8n

`examples/n8n-weekly-check.json` is a four-node workflow: Schedule, Execute Command, Code, IF, then an email when the check fails. It runs a read-only `scan`, so it is safe to schedule.

## Set up

1. Install the CLI on the machine that runs n8n (the Execute Command node runs on the n8n host):

   ```bash
   git clone https://github.com/waseemnasir2k26/lead-leak-audit.git /opt/lead-leak-audit
   cd /opt/lead-leak-audit && npm install && npx playwright install chromium
   ```

   On Linux servers also run `npx playwright install-deps chromium` once.

2. Import `examples/n8n-weekly-check.json` (Workflows, Import from file).
3. In the "Run lead-leak-audit" node, replace `https://your-site.example` and adjust `--threshold`.
4. In "Email me", pick your SMTP credential and set the from/to addresses.
5. Run it once by hand. The first run copies its report to `reports/baseline/report.json`. Later runs fail if the score is below the threshold **or** has dropped more than 10 points against that baseline (`--max-drop` changes the 10).
6. Activate the workflow.

When you fix leaks on purpose, refresh the baseline:

```bash
cp reports/latest/report.json reports/baseline/report.json
```

## How the check decides

| Flag                       | Meaning                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `--ci`                     | exit code 2 when the check fails (otherwise always 0)                                       |
| `--threshold 75`           | fail below this score                                                                       |
| `--baseline <report.json>` | fail if the score fell by more than `--max-drop` since that report                          |
| `--json`                   | print one JSON line (`score`, `grade`, `pass`, `reasons`, `html`, `json`) for the Code node |

The Code node reads that last JSON line, so the workflow works even if the process exit code is swallowed.

## Notes

- n8n 2.x disables the Execute Command node by default for security. Re-enable it only on a self-hosted instance you control (remove `n8n-nodes-base.executeCommand` from `NODES_EXCLUDE`).
- Do not schedule `submit` unattended unless you understand that it sends a real test lead every run. If you do, point `--email` at a dedicated test inbox and keep the credentials in environment variables (`LLA_IMAP_*`), never in the workflow.
- The workflow ships inactive and with a placeholder SMTP credential. The JSON was written by hand and has not been imported into a live n8n instance by the author; check the node versions against yours on import.
- Cron alternative, no n8n needed:

  ```cron
  0 7 * * 1  cd /opt/lead-leak-audit && node src/cli.js scan https://your-site.example --ci --threshold 75 --quiet || mail -s "Lead leak check failed" you@your-site.example < reports/report.json
  ```
