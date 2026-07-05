# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Fluxion Core is a keyboard-first project management dashboard (Next.js App Router + Neon Postgres via Prisma) that is also an MCP server: the same backend that renders the UI exposes issues, cycles, products, roadmaps, and documents as MCP tools so AI agents can read and act on project state directly. See `VISION.md` and `docs/goal_of_fluxion.md` for the product framing.

## Commands

```bash
npm run dev              # next dev, runs on PORT from .env (this repo uses 3002, not 3000)
npm run build
npx tsc --noEmit         # type check (gate 1 of CI)
npx eslint <files>       # lint specific files (gate 2 of CI — whole-repo lint has legacy debt and won't pass)
node --env-file=.env scripts/ci.mjs            # local CI: tsc + eslint on files changed in HEAD, reports build status to Fluxion's own telemetry webhook
node --env-file=.env scripts/ci.mjs --full     # + e2e suites (trail-sync, mcp-tools, mcp-sessions) and scripts/verify-hardening.sh
sh scripts/install-git-hooks.sh                # opt-in: runs ci.mjs in background on post-commit
```

There is no separate test framework — correctness is checked via `tsc`/`eslint` plus the live e2e scripts in `scripts/` (`test-trail-sync.mjs`, `test-mcp-tools.mjs`, `test-mcp-sessions.mjs`), which hit a running instance (`FLUXION_URL`, default `http://localhost:3002`) and require `FLUXION_API_KEY`. Run `npm run dev` first if you need these to pass.

Prisma: schema at `prisma/schema.prisma`, datasource is Neon (serverless Postgres) via `DATABASE_URL` in `.env`. This repo uses a local prisma binary/client — regenerate with `npx prisma generate` after schema changes; there's no local migration runner in scripts, so treat schema changes against the shared Neon DB carefully.

## Architecture

**Dual MCP transport, one tool registry.** `src/lib/mcp-tools.ts` is the single source of truth for every MCP tool (schema + handler). Two transports dispatch from it and must never drift apart:
- `src/pages/api/mcp/index.ts` — stateless HTTP JSON-RPC (Pages Router, not App Router — deliberate, for streaming control). Handles `initialize`/`tools/list`/`tools/call` directly, plus the SSE `GET` upgrade.
- `src/lib/mcp.ts` + `src/pages/api/mcp/messages.ts` — one `Server` instance per SSE session, tracked in `src/lib/mcp-state.ts`.

Both require `FLUXION_API_KEY` (`x-api-key` header, `Authorization: Bearer`, or `?token=`) — auth fails closed if the env var is unset (`src/lib/api-auth.ts`, used by REST/webhook routes; the MCP handler checks the key inline). JSON-RPC notifications (no `id`) must get a bare `202` with an empty body — some clients (e.g. Codex's rmcp) hard-fail on any JSON body for notifications.

**Server actions mirror MCP tools.** `src/actions/*.ts` are the Next.js server actions the dashboard UI calls; the write paths (status transitions, issue creation, etc.) funnel through the same `src/lib/*.ts` domain functions that the MCP tool handlers call, so the UI and agents can never enforce different rules.

**Status machines are graphs, not booleans.** Issue, Project, and Cycle status transitions are all enforced as explicit transition graphs (e.g. `STATUS_TRANSITIONS` in `src/lib/issues.ts`), not just "any status is valid." Same-status "transitions" are no-ops; illegal transitions throw agent-actionable errors listing the allowed set. Don't bypass these functions with raw `prisma.issue.update({ status })`.

**Fionn — the cognitive control layer (`src/lib/fionn/`, `agents/fionn.mjs`).** Fionn is deliberately split into a deterministic layer and an LLM agent that is a *client* of it — the layer never makes an LLM call itself:
- `gatekeeper.ts` — parses markdown checkbox acceptance criteria (`- [ ] ...`) into hashed `Criterion`s. Attestation state lives only in the `CriterionAttestation` table (evidence + attestor), never in the raw markdown checkbox state — editing criterion text invalidates its attestation. The `Done` transition is gated on every checkbox criterion being attested (`assertDoneGate`).
- `hydrator.ts` — deterministically assembles a single markdown "Context Package" for an issue (product vision → boundaries → parent objective → issue contract → repos → legal next statuses). Missing pieces render `*(not documented)*` rather than erroring.
- `agents/fionn.mjs` — the actual agent harness (triage / decompose / verify modes), calling Fluxion only through the stateless JSON-RPC MCP endpoint, never importing repo internals directly. Its own charter (see file header) forbids it from writing/editing/executing code — it governs and judges, execution agents do the engineering work.

When touching acceptance-criteria or status-transition logic, changes must stay consistent across `src/lib/issues.ts`/`projects.ts`/`cycles.ts`, `src/lib/fionn/gatekeeper.ts`, and both MCP transports.

**Identifiers and namespacing.** Issues get product-namespaced identifiers (e.g. `FLX-117`) minted in `src/lib/identifiers.ts`; issues with no product land in the `FLX` workspace product. Resolve issues/products/cycles/projects by either DB id or human slug/identifier — see the `resolve*` helpers in `src/lib/mcp-tools.ts`.

**Trail-sync (`src/lib/trail-sync.ts`, `src/app/api/products/[id]/route.ts` sync endpoint).** Idempotent batch sync for offline-captured deltas: each `SyncBatch` has a client-generated `batchKey` so replays return the stored result rather than double-applying; individual `SyncDelta`s can be Applied/Conflict/Rejected independently within a batch.

**Change Control is out-of-band decision tracking, not just a changelog.** The `ChangeLog` model records `approvedBy`/`implementedBy`/`reason` for deployments, migrations, and config changes made outside the normal issue lifecycle — record these directly and update any affected acceptance criteria, or the decision is invisible to Fionn's context hydration (which reads product docs and issue state, not this log).

## Working in this repo

- The MCP endpoint is a LAN/Tailscale control plane, not a public API — `next.config.ts` disables response compression specifically because gzip buffers the SSE stream into silence in production.
- `.env` holds live credentials (Neon `DATABASE_URL`, `FLUXION_API_KEY`, `ANTHROPIC_API_KEY`) and is gitignored — never commit it, and prefer `node --env-file=.env` over exporting these into a shell profile.
- This repo runs on Next.js 16 with breaking changes from what you may expect from training data — per `AGENTS.md`, check `node_modules/next/dist/docs/` before relying on prior Next.js knowledge, especially around routing/caching/streaming APIs.
