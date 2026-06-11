// Local CI runner (FLX-116): runs the quality gates and reports the result
// as a Build to Fluxion's own telemetry webhook, so the Command Center build
// pane tracks this repo and BUILD_FAILURE automation rules fire on regressions.
//
// Usage:
//   node --env-file=.env scripts/ci.mjs            # tsc + eslint on files changed in HEAD
//   node --env-file=.env scripts/ci.mjs --full     # + e2e suites and hardening checks
//
// Install as a background post-commit hook with: sh scripts/install-git-hooks.sh

import { execSync, spawnSync } from 'node:child_process';

const BASE_URL = process.env.FLUXION_URL || 'http://localhost:3002';
const API_KEY = process.env.FLUXION_API_KEY;
const FULL = process.argv.includes('--full');

const git = (cmd) => execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
const branch = git('rev-parse --abbrev-ref HEAD');
const commitHash = git('rev-parse --short HEAD');
const commitMsg = git('log -1 --pretty=%s');

const gates = [];

function run(label, cmd, args) {
  process.stdout.write(`[gate] ${label} ... `);
  const started = Date.now();
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  const ok = result.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (!ok) {
    console.log((result.stdout + result.stderr).split('\n').slice(0, 25).join('\n'));
  }
  gates.push({ label, ok });
  return ok;
}

// Gate 1: type check (whole project, always)
run('tsc --noEmit', 'npx', ['tsc', '--noEmit']);

// Gate 2: lint, scoped to lintable files changed in HEAD — the legacy files
// carry known lint debt, so a whole-repo gate would never pass.
const changed = git('diff-tree --no-commit-id --name-only -r HEAD')
  .split('\n')
  .filter((f) => /^(src|scripts)\/.*\.(ts|tsx|mjs)$/.test(f));
if (changed.length > 0) {
  run(`eslint (${changed.length} changed)`, 'npx', ['eslint', ...changed]);
} else {
  console.log('[gate] eslint ... SKIP (no lintable files in HEAD)');
}

// Gate 3 (--full): live suites against the running instance
if (FULL) {
  run('trail-sync e2e', 'node', ['--env-file=.env', 'scripts/test-trail-sync.mjs', BASE_URL]);
  run('mcp tools e2e', 'node', ['--env-file=.env', 'scripts/test-mcp-tools.mjs', BASE_URL]);
  run('mcp sessions e2e', 'node', ['--env-file=.env', 'scripts/test-mcp-sessions.mjs', BASE_URL]);
  run('hardening checks', 'sh', ['scripts/verify-hardening.sh', BASE_URL]);
}

const failed = gates.filter((g) => !g.ok);
const status = failed.length === 0 ? 'Success' : 'Failure';
const gateSummary = gates.map((g) => `${g.label}:${g.ok ? 'ok' : 'FAIL'}`).join(' ');

// Report the build to Fluxion itself
if (!API_KEY) {
  console.log('[telemetry] SKIP — FLUXION_API_KEY not set');
} else {
  try {
    const res = await fetch(`${BASE_URL}/api/webhooks/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        type: 'build',
        payload: {
          repoName: 'fluxion-core',
          branch,
          status,
          commitHash,
          commitMsg: `${commitMsg} [ci: ${gateSummary}]`,
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    console.log(`[telemetry] build ${status} reported for ${commitHash} -> HTTP ${res.status}`);
  } catch (err) {
    console.log(`[telemetry] WARN — could not reach Fluxion at ${BASE_URL}: ${err.message}`);
  }
}

console.log(`\nCI ${status}: ${gates.length - failed.length}/${gates.length} gates passed (${commitHash} on ${branch})`);
process.exit(failed.length === 0 ? 0 : 1);
