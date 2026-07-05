// Fluxion orchestrator harness v0 (FLX-134) — PCP v0.2 Git Branch Handoff.
//
// Brackets an execution agent's task with the PCP packet lifecycle, under
// the decided write-back compromise: Fluxion Core never writes to
// repositories; the local agent/human sandbox owns its clone. This harness
// runs IN that sandbox and calls Fluxion only through the stateless JSON-RPC
// MCP endpoint (like agents/fionn.mjs) — validation, briefing rendering, and
// re-fingerprinting all happen in the deterministic layer (src/lib/pcp.ts).
//
// This is NOT Fionn: Fionn's charter (fionn-project-charter) restricts it to
// cognitive control. Orchestration of execution lifecycles — briefing agents
// at launch and directing packet write-back at completion — lives here.
//
// Lifecycle:
//   node --env-file=.env agents/orchestrator.mjs brief <repoPath> [--issue FLX-134]
//     Launch stage: read pcp/context.json from the workspace clone, have the
//     layer validate schema + fingerprint, and print the read-only briefing
//     (optionally prefixed by the Fluxion issue Context Package) to stdout
//     for injection into the executing agent's prompt. Exits non-zero on a
//     missing, malformed, or tampered packet — no briefing, no launch.
//
//   node --env-file=.env agents/orchestrator.mjs finalize <repoPath> \
//        [--evaluation-status <s> --evaluation-reason <r>] [--note "<text>"] \
//        [--update '<json>'] [--message "<commit msg>"] [--no-commit]
//     Finalization stage: apply the agent's packet-state updates, have the
//     layer re-fingerprint and serialize, write pcp/context.json back into
//     the clone, then commit it to the ACTIVE FEATURE BRANCH (refuses on
//     main/master) and verify the commit contains the packet — the handoff
//     artifact human reviewers see in the PR.
//
// Config (env): FLUXION_URL (default http://localhost:3002), FLUXION_API_KEY (required)

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.env.FLUXION_URL || 'http://localhost:3002';
const FLUXION_KEY = process.env.FLUXION_API_KEY;
if (!FLUXION_KEY) throw new Error('FLUXION_API_KEY must be set');

// --- Fluxion layer access (stateless JSON-RPC), as in agents/fionn.mjs ---
let rpcId = 0;
async function layer(tool, args) {
  const res = await fetch(`${BASE_URL}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': FLUXION_KEY },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`layer ${tool}: ${json.error.message}`);
  return json.result.content[0].text;
}

function git(repoPath, ...argv) {
  return execFileSync('git', argv, { cwd: repoPath, encoding: 'utf8' }).trim();
}

function packetPath(repoPath) {
  return join(repoPath, 'pcp', 'context.json');
}

function readPacketRaw(repoPath) {
  const p = packetPath(repoPath);
  if (!existsSync(p)) throw new Error(`no PCP packet at ${p} — this repository has no pcp/context.json to brief from`);
  return readFileSync(p, 'utf8');
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'no-commit') { flags.noCommit = true; continue; }
    flags[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  return flags;
}

// --- Launch stage: read-only briefing ---
async function brief(repoPath, flags) {
  const raw = readPacketRaw(repoPath);
  const briefing = await layer('brief_pcp_packet', { content: raw });
  const parts = [];
  if (flags.issue) {
    parts.push(await layer('hydrate_issue_context', { identifier: flags.issue }));
    parts.push('---');
  }
  parts.push(briefing);
  console.log(parts.join('\n\n'));
}

// --- Finalization stage: state update -> re-fingerprint -> write -> commit ---
async function finalize(repoPath, flags) {
  const packet = JSON.parse(readPacketRaw(repoPath));

  if (flags.update) {
    Object.assign(packet, JSON.parse(flags.update));
  }
  if (flags.evaluationStatus || flags.evaluationReason) {
    packet.evaluation = {
      status: flags.evaluationStatus ?? packet.evaluation?.status ?? 'unknown',
      reason: flags.evaluationReason ?? packet.evaluation?.reason ?? '(not stated)',
    };
  }
  if (flags.note) {
    packet.context_notes = [...(packet.context_notes ?? []), flags.note];
  }

  // Gate on the branch BEFORE touching the workspace: a refused finalize
  // must leave the clone exactly as it found it.
  const branch = git(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD');
  if (!flags.noCommit && (branch === 'main' || branch === 'master' || branch === 'HEAD')) {
    throw new Error(`refusing to commit packet write-back on "${branch}" — the Git Branch Handoff requires an active feature branch so the change lands as a reviewable PR. Create/checkout a feature branch and re-run finalize.`);
  }

  // The layer validates the updated packet and owns canonicalization —
  // agents never hand-roll fingerprints.
  const result = JSON.parse(await layer('refingerprint_pcp_packet', { content: JSON.stringify(packet) }));
  writeFileSync(packetPath(repoPath), result.fileContent);
  console.log(`pcp/context.json updated — fingerprint ${result.fingerprint} (updated_at ${result.updated_at})`);

  if (flags.noCommit) {
    console.log('--no-commit: write-back staged for a manual commit; the handoff is not complete until the packet is committed to the feature branch.');
    return;
  }

  git(repoPath, 'add', 'pcp/context.json');
  const message = flags.message || `chore(pcp): update context packet state [orchestrator finalize]`;
  git(repoPath, 'commit', '-m', message);

  // Verify the handoff artifact: the new HEAD commit must contain the packet.
  const committed = git(repoPath, 'show', '--name-only', '--pretty=format:', 'HEAD').split('\n').filter(Boolean);
  if (!committed.includes('pcp/context.json')) {
    throw new Error(`commit created on ${branch} but pcp/context.json is not in it (files: ${committed.join(', ') || 'none'}) — handoff verification failed`);
  }
  console.log(`committed to ${branch} (${git(repoPath, 'rev-parse', '--short', 'HEAD')}): pcp/context.json verified in HEAD — ready for PR review`);
}

// --- CLI ---
const [mode, repoPath, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);

try {
  if (mode === 'brief' && repoPath) {
    await brief(repoPath, flags);
  } else if (mode === 'finalize' && repoPath) {
    await finalize(repoPath, flags);
  } else {
    console.error('usage: orchestrator.mjs brief <repoPath> [--issue FLX-134]');
    console.error('       orchestrator.mjs finalize <repoPath> [--evaluation-status s --evaluation-reason r] [--note text] [--update json] [--message msg] [--no-commit]');
    process.exit(2);
  }
} catch (e) {
  console.error(`orchestrator ${mode ?? ''}: ${e.message}`);
  process.exit(1);
}
