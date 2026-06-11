// Exercises the MCP tool registry over the stateless HTTP JSON-RPC surface.
// Usage: node --env-file=.env scripts/test-mcp-tools.mjs [baseUrl]
// Creates scratch entities, verifies the new tools, and cleans up after itself.

import { PrismaClient } from '@prisma/client';

const BASE_URL = process.argv[2] || 'http://localhost:3002';
const API_KEY = process.env.FLUXION_API_KEY;
if (!API_KEY) {
  console.error('FLUXION_API_KEY must be set');
  process.exit(1);
}
const prisma = new PrismaClient();

let failures = 0;
function check(label, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`  [${mark}] ${label}${condition || !detail ? '' : ` — ${detail}`}`);
}

let rpcId = 0;
async function rpc(method, params) {
  const res = await fetch(`${BASE_URL}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  return res.json();
}
const call = (name, args) => rpc('tools/call', { name, arguments: args });
const textOf = (r) => r?.result?.content?.[0]?.text ?? '';

// --- 1. Registry parity: HTTP surface lists the full tool set ---
console.log('1. tools/list (HTTP surface, previously drifted to 13 tools)');
const list = await rpc('tools/list');
const names = (list?.result?.tools ?? []).map((t) => t.name);
check('21 tools listed', names.length === 21, `got ${names.length}: ${names.join(', ')}`);
for (const t of ['update_issue', 'search', 'read_product_metrics', 'archive_product', 'read_document', 'write_document', 'create_change_log', 'query_telemetry']) {
  check(`${t} present`, names.includes(t));
}

// --- 2. update_issue ---
console.log('\n2. update_issue');
const created = await call('create_issue', { title: '[SCRATCH] tool-surface test issue', priority: 'Low' });
const scratchId = textOf(created).match(/FLX-\d+/)?.[0];
check('scratch issue created', !!scratchId, textOf(created));
const up1 = await call('update_issue', { identifier: scratchId, priority: 'High', description: 'updated by registry test' });
check('update by identifier works', textOf(up1).includes('priority') && textOf(up1).includes(scratchId), textOf(up1));
const row = await prisma.issue.findUnique({ where: { identifier: scratchId } });
check('fields persisted', row?.priority === 'High' && row?.description === 'updated by registry test');
const up2 = await call('update_issue', { identifier: 'FLX-99999', title: 'x' });
check('unknown identifier errors', !!up2.error, JSON.stringify(up2));
const up3 = await call('update_issue', { identifier: scratchId });
check('no-fields call errors', !!up3.error);

// --- 3. search ---
console.log('\n3. search');
const s1 = await call('search', { query: 'tool-surface test' });
const s1res = JSON.parse(textOf(s1));
check('finds scratch issue', s1res.issues.some((i) => i.identifier === scratchId), textOf(s1).slice(0, 200));
const s2 = await call('search', { query: 'Trail-Mode' });
const s2res = JSON.parse(textOf(s2));
check('multi-index returns issues/documents/changeLogs keys', 'issues' in s2res && 'documents' in s2res && 'changeLogs' in s2res);
const s3 = await call('search', {});
check('missing query errors', !!s3.error);

// --- 4. read_product_metrics ---
console.log('\n4. read_product_metrics');
const m1 = await call('read_product_metrics', { productSlug: 'flx' });
const m1res = JSON.parse(textOf(m1));
check('resolves product by slug (case-insensitive input)', m1res.product?.slug === 'FLX');
check('metrics shape complete', ['openIssues', 'closedIssues', 'openDefects', 'closedDefects', 'techDebtPoints', 'roadmapCompletion', 'totalRoadmaps'].every((k) => typeof m1res.metrics?.[k] === 'number'), textOf(m1));
const m2 = await call('read_product_metrics', { productSlug: 'NOPE' });
check('unknown product errors', !!m2.error);

// --- 5. archive_product ---
console.log('\n5. archive_product');
const cp = await call('create_product', { name: 'Scratch Archive Target', description: 'registry test' });
const scratchSlug = textOf(cp).match(/slug ([A-Z0-9-]+)/)?.[1];
check('scratch product created', !!scratchSlug, textOf(cp));
const ar = await call('archive_product', { productSlug: scratchSlug });
check('archives by slug', textOf(ar).includes('archived'), textOf(ar));
const prow = await prisma.product.findUnique({ where: { slug: scratchSlug } });
check('status is Archived', prow?.status === 'Archived');
const ar2 = await call('archive_product', { productSlug: scratchSlug });
check('idempotent re-archive message', textOf(ar2).includes('already archived'));

// --- Cleanup ---
await prisma.issue.deleteMany({ where: { identifier: scratchId ?? '' } });
if (scratchSlug) await prisma.product.delete({ where: { slug: scratchSlug } });
console.log('\nScratch entities cleaned up.');

await prisma.$disconnect();
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
