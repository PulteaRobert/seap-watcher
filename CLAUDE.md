# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Node.js/TypeScript service that polls the Romanian public procurement portal SEAP
(e-licitatie.ro) once daily for new tenders in Brasov county and sends a WhatsApp
alert via Baileys (WhatsApp Web automation). State (seen tenders, run history) is
kept in a local SQLite file via better-sqlite3.

```
SEAP API (1x/day) → SQLite (store) → alerted=0 filter → WhatsApp (alert)
```

## Commands

```bash
npm run dev          # run with tsx, no build step (src/index.ts)
npm run build        # tsc -> dist/
npm start             # run compiled dist/index.js
npm run run-once      # node dist/index.js --run-once (single manual check, then exit)
npm test               # vitest run (single run)
npm run test:watch     # vitest watch mode
```

Run a single test file: `npx vitest run src/dedup/engine.test.ts`

There is no lint script configured — TypeScript's `strict` mode (via `npm run build`)
is the only static check.

Local dev without a live WhatsApp connection: `NO_OP_WHATSAPP=1 npm start` (or `npm run dev`)
uses `src/whatsapp/noop.ts`, which logs messages instead of sending them.

## Architecture

**Pipeline entry point:** `src/scheduler.ts` `runCheck()` is the single orchestration
function used by both the cron scheduler and `--run-once`. It calls, in order:
`fetchBrasovTenders` (fetch+store+return-new) → `formatWhatsAppMessage` →
`sendWithRetry` → `markAsAlerted`. WhatsApp is only connected once there are
tenders to alert on — `runCheck` calls `whatsapp.connect()` right before
`sendWithRetry` (after `waitUntilConnected` confirms the socket is actually
open, not just constructed) and `whatsapp.close()` in a `finally` right after,
rather than holding a connection open for the whole run (which, for the DA
tier, can take 10-20 minutes) or for the process's entire lifetime. This keeps
each send on a short-lived, freshly-opened session and was a deliberate fix
after a long-held connection's Signal session desynced
(`MessageCounterError: Key used already or never filled`, unrecoverable by
retrying — the ratchet state itself needs a fresh session, not just a retry).

**Deduplication is DB-state-based, not diff-based.** `src/dedup/engine.ts`
(`computeDiff`/`alertableTenders`) exists but is **not wired into the pipeline** —
it's dead code from an earlier design. The actual mechanism: every fetched tender is
upserted into the `tenders` table (`src/db/operations.ts: upsertTenders`), and
"new" tenders are simply those with `alerted = 0` (`getNewTenders`). After a
successful WhatsApp send, `markAsAlerted` flips that flag. If you need to touch
dedup logic, the real logic lives in the upsert + alerted-flag pair, not in
`dedup/engine.ts`.

**SEAP has no official public API.** `src/seap/client.ts` calls undocumented
endpoints reverse-engineered from the SEAP web UI (and cross-checked against
`n8n-nodes-seap`): `NoticeCommon/GetCNoticeList` for above-threshold tenders (CAN /
licitații publice) and `DaPublic/DaPublicList` for sub-threshold tenders (DA /
achiziții directe). These are two structurally different response shapes unified
into one `SeapTender` type via `mapTender`. SEAP's API does not support a real date
or county filter — `fetch.ts` fetches a window and filters client-side, and
`isBrasovTender` does substring matching against a hardcoded `BRASOV_KEYWORDS` list
in `client.ts` (this list is broader than "Brasov" — it includes neighboring county
towns caught by the same authorities; edit that list if the alert set needs
tightening/widening rather than changing the matching logic itself). The DA endpoint
call is wrapped in its own try/catch that swallows failures (endpoint may not exist
or may change shape) rather than failing the whole run.

**Fetch window overlap is intentional.** `fetchBrasovTenders` always looks back 30
hours — a ~6h margin over the 24h gap between daily runs — so nothing is missed by
clock drift or a delayed run. Real "new" filtering still happens via the `alerted`
flag, not the window.

**Pagination walks to the real end of the result set, not just one page.**
`searchAboveThresholdTenders`/`searchSubThresholdTenders` (`client.ts`) fetch in
`chunkSize`-item chunks (the caller passes `config.maxTendersPerRun`, default 200)
but keep paginating past each chunk — pausing 50-120s (`chunkDelay`) between
chunks — until SEAP itself returns a short/empty page, up to a hard
`MAX_PAGES_PER_SEARCH` safety cap. This matters most for the DA (sub-threshold)
endpoint: its `finalizationDateStart/End` params filter by when a DA closes, not
when it was published, and results come back **unsorted** (verified empirically —
an unfiltered fetch returns items spanning months, out of publication order, and
the server hard-caps `total`/results at 2000 regardless of filters). So the real
publication-window filter for DA tenders happens client-side inside
`searchSubThresholdTenders` (`raw.publicationDate` compared against `dateFrom`/
`dateTo`), and only walking every page gives that filter a real chance of finding
everything in-window — truncating at one page's worth (as the old implementation
did) silently dropped genuine matches. The above-threshold (CAN) endpoint, by
contrast, is properly sorted newest-first and honors its date filter server-side,
so exhausting its pages mostly just means fewer, faster chunks. Because of the
per-chunk waits, a full daily run can now take on the order of 10-20 minutes
(dominated by the DA tier, which can walk the whole ~2000-item cap) rather than a
few seconds — this is intentional pacing, not a hang.

**Config is the single source of env truth.** `src/config.ts` defines a Zod schema
and is the only place that reads `process.env` for app settings (`loadConfig()`).
Add new env vars there, not by reading `process.env` elsewhere.

**WhatsApp client is behind an interface.** `src/whatsapp/types.ts` defines
`WhatsAppClient` (`connect`, `waitUntilConnected`, `sendMessage`, `isConnected`,
`close`); both `client.ts` (real Baileys) and `noop.ts` (dev) implement it, and
`scheduler.ts` / `index.ts` depend only on the interface. `send.ts`'s
`sendWithRetry` wraps `sendMessage` with backoff and is what the pipeline
actually calls — tenders are only marked `alerted` if this returns `true`.
`client.ts` also holds a PID lockfile (`session/.session.lock`) for the
duration of a connection, so a second process (e.g. `scripts/test-send.js` or
a manual `--run-once`) can't open the same Baileys session concurrently —
concurrent connections racing on the same session files is what caused the
Signal-session corruption mentioned above.

**Module layout:** `src/config.ts` (env/config), `src/seap/` (external API +
mapping), `src/db/` (SQLite schema in `database.ts`, CRUD in `operations.ts`),
`src/dedup/` (unused diff engine, see above), `src/format/` (Romanian-language
WhatsApp message text), `src/whatsapp/` (client implementations), `src/scheduler.ts`
(cron + orchestration), `src/index.ts` (bootstrap/shutdown).

## Deployment

Production runs on a VPS as a systemd service (`deploy/systemd/seap-watcher.service`),
not as a container. `.github/workflows/deploy.yml` builds on push to `master` and
SSHes in to run `deploy/deploy.sh`; `deploy/setup.sh` is the one-time VPS bootstrap
(creates a `seap` system user, installs to `/opt/seap-watcher`, installs the systemd
unit). WhatsApp auth session is persisted under `session/` (Baileys multi-file auth
state) and survives restarts; deleting it forces a fresh QR-code login.
