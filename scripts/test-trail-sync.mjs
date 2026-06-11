// FLX-111 end-to-end test runner for the Trail-Mode delta ingest endpoint.
// Usage: node --env-file=.env scripts/test-trail-sync.mjs [baseUrl]
// Exercises: full apply, within-batch clientRef resolution, idempotent replay,
// offline approvals (with ChangeLog audit), roadmap rollup updates,
// stale-delta conflict detection, unknown-target rejection, and auth failures.

import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const BASE_URL = process.argv[2] || 'http://localhost:3002';
const API_KEY = process.env.FLUXION_API_KEY || 'fluxion_secret_key_2026';
const RUN = `run-${Date.now()}`;
const prisma = new PrismaClient();

let failures = 0;
function check(label, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`  [${mark}] ${label}${condition || !detail ? '' : ` — ${detail}`}`);
}

function loadBatch(file, subs) {
  let text = readFileSync(new URL(`../test-payloads/trail-sync/${file}`, import.meta.url), 'utf8');
  const now = Date.now();
  const builtins = {
    __RUN__: RUN,
    __NOW__: new Date(now).toISOString(),
    __T_MINUS_3H__: new Date(now - 3 * 3600_000).toISOString(),
    __T_MINUS_2H__: new Date(now - 2 * 3600_000).toISOString(),
    __T_MINUS_1H__: new Date(now - 3600_000).toISOString(),
    __T_MINUS_30M__: new Date(now - 30 * 60_000).toISOString(),
    __T_MINUS_20M__: new Date(now - 20 * 60_000).toISOString(),
    __T_MINUS_10M__: new Date(now - 10 * 60_000).toISOString(),
    __T_MINUS_5M__: new Date(now - 5 * 60_000).toISOString(),
    ...subs,
  };
  for (const [key, value] of Object.entries(builtins)) {
    text = text.replaceAll(key, value);
  }
  return JSON.parse(text);
}

async function post(body, apiKey = API_KEY) {
  const res = await fetch(`${BASE_URL}/api/products/trail-sync/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// --- Setup: make sure the roadmap targeted by batch 2 exists ---
const product = await prisma.product.findUnique({ where: { slug: 'TRAIL-SYNC' } });
if (!product) {
  console.error('TRAIL-SYNC product is not provisioned; aborting.');
  process.exit(1);
}
const roadmapName = 'Trail Telemetry GA';
const existingRoadmap = await prisma.roadmap.findFirst({
  where: { productId: product.id, name: roadmapName },
});
if (!existingRoadmap) {
  // Backdated: the roadmap logically pre-exists the offline hike being simulated.
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
  await prisma.roadmap.create({
    data: { name: roadmapName, status: 'Planned', productId: product.id, createdAt: weekAgo, updatedAt: weekAgo },
  });
  console.log(`Provisioned roadmap "${roadmapName}" for TRAIL-SYNC.`);
}

// --- 1. Offline hike transitions: creates + within-batch clientRef update ---
console.log('\n1. Hike transitions (creates + clientRef update)');
const batch1 = loadBatch('batch-1-hike-transitions.json');
const r1 = await post(batch1);
check('returns 201', r1.status === 201, `got ${r1.status}: ${JSON.stringify(r1.json)}`);
check('all 3 deltas applied', r1.json.appliedCount === 3, JSON.stringify(r1.json.results));
check('batch status Applied', r1.json.status === 'Applied');
const issue1 = r1.json.results?.find((r) => r.seq === 1)?.resultRef;
const issue2 = r1.json.results?.find((r) => r.seq === 2)?.resultRef;
check('namespaced identifiers minted', /^TRAIL-SYNC-\d+$/.test(issue1 ?? ''), `got ${issue1}`);
check(
  'clientRef update resolved to created issue',
  r1.json.results?.find((r) => r.seq === 3)?.resultRef === issue1
);

// --- 2. Idempotent replay of the same batchKey ---
console.log('\n2. Replay of batch 1 (idempotency)');
const r1b = await post(batch1);
check('returns 200', r1b.status === 200, `got ${r1b.status}`);
check('alreadyApplied flag set', r1b.json.alreadyApplied === true);
check('stored results returned', r1b.json.results?.length === 3);
const issueCount = await prisma.issue.count({ where: { identifier: { in: [issue1, issue2] } } });
check('no duplicate issues created', issueCount === 2);

// --- 3. Ridge connections: approval queue + roadmap rollup ---
console.log('\n3. Ridge connections (approvals + roadmap update)');
const batch2 = loadBatch('batch-2-ridge-connections.json', {
  __ISSUE_1__: issue1,
  __ISSUE_2__: issue2,
});
const r2 = await post(batch2);
check('returns 201', r2.status === 201, JSON.stringify(r2.json));
check('all 3 deltas applied', r2.json.appliedCount === 3, JSON.stringify(r2.json.results));
const approved = await prisma.issue.findUnique({ where: { identifier: issue1 } });
check('approved issue now Done', approved?.status === 'Done');
const changeLog = await prisma.changeLog.findFirst({
  where: { type: 'Offline Approval', issue: { identifier: issue1 } },
});
check('approval recorded in ChangeLog', !!changeLog, 'no Offline Approval entry found');
const roadmap = await prisma.roadmap.findFirst({ where: { productId: product.id, name: roadmapName } });
check('roadmap rolled to Active', roadmap?.status === 'Active');

// --- 4. Conflict + rejection handling ---
console.log('\n4. Stale conflict, unknown target, partial apply');
const batch3 = loadBatch('batch-3-conflict-replay.json', { __ISSUE_1__: issue1 });
const r3 = await post(batch3);
check('returns 201', r3.status === 201, JSON.stringify(r3.json));
check('stale delta flagged as Conflict', r3.json.results?.find((r) => r.seq === 1)?.status === 'Conflict');
check('unknown target Rejected', r3.json.results?.find((r) => r.seq === 2)?.status === 'Rejected');
check('valid create still Applied', r3.json.results?.find((r) => r.seq === 3)?.status === 'Applied');
check('batch status Partial', r3.json.status === 'Partial');
const afterConflict = await prisma.issue.findUnique({ where: { identifier: issue1 } });
check('server state preserved after stale delta', afterConflict?.status === 'Done');

// --- 5. Auth & validation guards ---
console.log('\n5. Auth and validation guards');
const bad = await post(loadBatch('batch-1-hike-transitions.json', { __RUN__: `${RUN}-x` }), 'wrong-key');
check('invalid API key rejected with 401', bad.status === 401);
const malformed = await post({ batchKey: `empty-${RUN}`, deltas: [] });
check('empty delta array rejected with 400', malformed.status === 400);

// --- 6. Transaction log persisted ---
console.log('\n6. Transaction log');
const batchRow = await prisma.syncBatch.findUnique({
  where: { batchKey: batch1.batchKey },
  include: { deltas: true },
});
check('SyncBatch row persisted', !!batchRow);
check('per-delta transaction log persisted', batchRow?.deltas.length === 3);

await prisma.$disconnect();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
