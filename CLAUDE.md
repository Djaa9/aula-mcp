# Fork notes: daily Aula digest

This is Djaa9's fork of Casperjuel/aula-mcp (`upstream` remote). The fork adds
`apps/digest`, a daily email digest of the kids' Aula data, on branch
`feat/digest`. The rest of the repo is upstream; keep fork changes to the
digest so syncing stays cheap.

## How the digest works

`apps/digest/src/run.ts`, one run per invocation, then exit:

1. `state.ts` seeds `$AULA_MCP_DIR/tokens.json` from `AULA_TOKENS_SEED`
   (base64 of an encrypted `aula tokens export`), once per distinct seed,
   tracked by `seed.sha256`. Never re-apply an old seed: the volume holds the
   rotated refresh token.
2. `collect.ts` drives the existing MCP tools in-process (McpServer +
   `registerTools` + `InMemoryTransport`) rather than calling AulaClient, so
   vendor detection and guardian-profile priming stay in `tools.ts`. Fetches:
   discover, calendar this + next week (non-lesson events only), message
   threads and posts from the last 30 days (`isNew` marks those since
   `lastRunAt`), and the vendor tools for the widgets the school has
   (`WIDGET_PROVIDER_MAP`, plus MU opgaver whenever 0029 is present).
3. `compose.ts`: one Claude call (`claude-opus-5-5`, effort medium,
   server-side fallback on, `DIGEST_MODEL` overrides) writes a Danish HTML
   fragment.
4. `send.ts`: Resend HTTPS API. Then `lastRunAt` goes to `digest-state.json`.
5. Any failure sends an "Aula-digest fejlede" email and exits 1.

`DIGEST_DRY_RUN=1` writes the HTML to `$TEMP/aula-digest.html` instead of
sending and leaves `lastRunAt` alone.

Upstream touch points: `WIDGET_PROVIDER_MAP` and `htmlToText` are exported
from `@aula-mcp/mcp-server` for the digest.

## Deployment

- Railway project `aula-digest`, service `digest`, deploys from
  `Djaa9/aula-mcp` branch `feat/digest` via `apps/digest/Dockerfile`
  (`railway.json`). Pushing the branch deploys.
- Cron `30 4 * * *` (UTC, so 06:30 summer / 05:30 winter Copenhagen). It had
  to be set in the dashboard; `railway.json`'s `cronSchedule` was not applied.
  A deploy does not run the job; use "Run now" in the dashboard.
- Volume `digest-volume` at `/data` (`AULA_MCP_DIR`).
- Variables: `AULA_MCP_KEY`, `AULA_TOKENS_SEED`, `ANTHROPIC_API_KEY`,
  `RESEND_API_KEY`, `DIGEST_FROM=Aula <aula@thepage.dk>`,
  `DIGEST_TO=jp@thepage.dk,karend@vidsen.com` (comma-separated; failure
  emails go to all recipients too, on purpose).
- Email: Resend, domain thepage.dk (EU region), DNS at one.com. The domain's
  normal mail is Proton (MX/SPF on the apex, DMARC p=quarantine); Resend's
  records live on `send` and `resend._domainkey` only.

## Re-login runbook

`aula login` cannot run on Railway (STIL bot protection blocks datacenter
IPs). From `E:\repros\aula-mcp` in PowerShell:

```powershell
pnpm aula login
pnpm aula tokens export "$env:TEMP\aula-bundle"
(Get-Content -Raw "$env:TEMP\aula-bundle\.key").Trim() | railway.cmd variable set AULA_MCP_KEY --stdin --service digest --skip-deploys
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:TEMP\aula-bundle\tokens.json")) | railway.cmd variable set AULA_TOKENS_SEED --stdin --service digest --skip-deploys
Remove-Item -Recurse -Force "$env:TEMP\aula-bundle"
pnpm aula logout
```

Log out locally afterwards so the PC and Railway don't share one refresh-token
chain. A later local `pnpm aula login` is a separate session and is fine.

## Status and open items (as of 2026-10-05)

- First real digest sent 2026-10-05 and read well.
- Unverified: token refresh from Railway. The first run still used the
  exported access token; the first scheduled run is the real test. How long a
  refresh token lives is unknown.
- The school's widgets are 0023 (MU SSO), 0029 (MU Ugenoter), 0019
  (library), 0072 (MU absence). Ugenoter returns `personer: []` for every week
  tried (W39-W42); unknown whether the school writes none or the integration
  fails for this school.
- MU Opgaver (widget 0030) is not enabled in Aula for this school, but the
  opgaveliste endpoint answers anyway (verified 2026-10-05), so the digest
  calls it alongside ugebrev.
- Cleanup: unused `SMTP_USER` / `SMTP_TOKEN` may still be on the Railway
  service; the Proton SMTP token should be revoked.

## Decisions and why

- 30-day message lookback: the school rarely uses the calendar and
  announces trips in messages days or weeks ahead (a 5.B trip on 10-05 was
  sent 09-30 and missed by the since-last-run window).
- Script, not an agent loop: a fixed-shape digest gains nothing from letting
  the model pick tools each morning, and costs more.
- Resend, not SMTP: Railway Hobby blocks outbound SMTP (465/587). Proton SMTP
  was tried and reverted.
- One service owns the token volume. Two processes refreshing copies of one
  refresh token would invalidate each other.

## Windows gotchas on this machine

- PowerShell blocks the unsigned `bun.ps1` / `railway.ps1` shims: use
  `bun.cmd` / `railway.cmd`, or go through pnpm.
- Git Bash rewrites `/data`-style arguments into Windows paths: prefix with
  `MSYS_NO_PATHCONV=1`.
- `pnpm lint` reports CRLF formatting errors across the whole checkout
  (`core.autocrlf=true`); commits are stored as LF. Lint changed files with
  `npx biome check <paths>`.
- `pnpm aula login` is interactive: run it in a real terminal, not via `!`.
