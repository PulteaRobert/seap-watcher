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
`sendWithRetry` → `markAsAlerted`.

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

**Config is the single source of env truth.** `src/config.ts` defines a Zod schema
and is the only place that reads `process.env` for app settings (`loadConfig()`).
Add new env vars there, not by reading `process.env` elsewhere.

**WhatsApp client is behind an interface.** `src/whatsapp/types.ts` defines
`WhatsAppClient` (`connect`, `sendMessage`, `isConnected`, `close`); both
`client.ts` (real Baileys) and `noop.ts` (dev) implement it, and `scheduler.ts` /
`index.ts` depend only on the interface. `send.ts`'s `sendWithRetry` wraps
`sendMessage` with backoff and is what the pipeline actually calls — tenders are
only marked `alerted` if this returns `true`.

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
