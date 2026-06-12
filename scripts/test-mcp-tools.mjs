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
check('25 tools listed', names.length === 25, `got ${names.length}: ${names.join(', ')}`);
for (const t of ['update_issue', 'search', 'read_product_metrics', 'archive_product', 'read_document', 'write_document', 'create_change_log', 'query_telemetry', 'read_issue', 'read_project', 'hydrate_issue_context', 'decompose_issue']) {
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

// --- 6. Issue protocol layer (FLX-117) ---
console.log('\n6. Issue protocol: contract fields, hierarchy, state machine');
const parent = await call('create_issue', {
  title: '[SCRATCH] protocol parent',
  status: 'Triage',
  context: 'why this exists',
  acceptanceCriteria: '- it works',
  technicalIntent: 'do it well',
});
const parentId2 = textOf(parent).match(/FLX-\d+/)?.[0];
check('create with Triage status + contract fields', !!parentId2, textOf(parent));

const child = await call('create_issue', { title: '[SCRATCH] protocol child', parentIdentifier: parentId2 });
const childId = textOf(child).match(/FLX-\d+/)?.[0];
check('create with parentIdentifier', !!childId, textOf(child));

const full = await call('read_issue', { identifier: parentId2 });
const fullRes = JSON.parse(textOf(full));
check('read_issue returns contract fields', fullRes.context === 'why this exists' && fullRes.acceptanceCriteria === '- it works' && fullRes.technicalIntent === 'do it well');
check('read_issue returns children', fullRes.children?.some((c) => c.identifier === childId));
check('read_issue lists allowed transitions from Triage', Array.isArray(fullRes.allowedNextStatuses) && fullRes.allowedNextStatuses.includes('Todo') && !fullRes.allowedNextStatuses.includes('Done'));

const badTransition = await call('update_issue', { identifier: parentId2, status: 'Done' });
check('illegal transition Triage->Done rejected with allowed states', !!badTransition.error && badTransition.error.message.includes('Allowed from'), JSON.stringify(badTransition.error ?? badTransition));

const goodTransition = await call('update_issue', { identifier: parentId2, status: 'In Progress' });
check('legal transition Triage->In Progress applied', textOf(goodTransition).includes('status'), JSON.stringify(goodTransition));

const detach = await call('update_issue', { identifier: childId, parentIdentifier: 'none' });
check('child detached via parentIdentifier none', textOf(detach).includes('parentId'), JSON.stringify(detach));

// --- 7. Document upsert + revision history (FLX-120) ---
console.log('\n7. write_document upsert + revisions');
const docSlug = `scratch-upsert-doc-${Date.now()}`;
const w1 = await call('write_document', { title: '[SCRATCH] Upsert Doc', slug: docSlug, content: 'v1 content', docType: 'Vision' });
check('first write publishes', textOf(w1).includes('published'), textOf(w1));
const w2 = await call('write_document', { title: '[SCRATCH] Upsert Doc v2', slug: docSlug, content: 'v2 content', docType: 'Vision' });
check('second write updates (no duplicate)', textOf(w2).includes('updated') && textOf(w2).includes('revision history'), textOf(w2));
const docRow = await prisma.document.findUnique({ where: { slug: docSlug }, include: { revisions: true } });
check('content updated in place', docRow?.content === 'v2 content' && docRow?.title === '[SCRATCH] Upsert Doc v2');
check('prior version snapshotted to revision', docRow?.revisions.length === 1 && docRow?.revisions[0].content === 'v1 content');
const wBad = await call('write_document', { title: '[SCRATCH] bad type', content: 'x', docType: 'Thesis' });
check('invalid docType rejected', !!wBad.error, JSON.stringify(wBad.error ?? wBad));

// --- 8. Project protocol: slug, lifecycle, read_project, decision logs (FLX-125) ---
console.log('\n8. Project protocol');
const cp2 = await call('create_project', { name: '[SCRATCH] Project Protocol Test', status: 'Active' });
const projSlug = textOf(cp2).match(/slug ([a-z0-9-]+)/)?.[1];
check('create_project mints slug + accepts status', !!projSlug && textOf(cp2).includes('Active'), textOf(cp2));
const badStatus = await call('create_project', { name: '[SCRATCH] bad', status: 'Zombie' });
check('invalid project status rejected', !!badStatus.error);
const projRow = await prisma.project.findUnique({ where: { slug: projSlug } });
const dl = await call('create_change_log', { type: 'Decision', description: '[SCRATCH] chose option A', reason: 'testing', approvedBy: 'suite', implementedBy: 'suite', projectId: projRow.id });
check('decision log scopes to project', textOf(dl).includes('Decision'), textOf(dl));
const rp = await call('read_project', { slug: projSlug });
const rpRes = JSON.parse(textOf(rp));
check('read_project returns status report + transitions', rpRes.statusReport?.totalIssues === 0 && Array.isArray(rpRes.allowedNextStatuses) && rpRes.allowedNextStatuses.includes('On Hold'));
check('read_project includes project-scoped change logs', rpRes.changeLogs?.some((l) => l.type === 'Decision'));
const projDoc = await call('write_document', { title: '[SCRATCH] Charter', slug: `scratch-charter-${Date.now()}`, content: 'x', docType: 'Charter' });
check('Charter docType accepted', textOf(projDoc).includes('published'), JSON.stringify(projDoc));

// --- 9. Fionn M1: Context Hydrator (FLX-121) ---
console.log('\n9. hydrate_issue_context');
const h1 = await call('hydrate_issue_context', { identifier: 'FLX-121' });
const pkg = textOf(h1);
check('package has all sections in order', ['# Context Package: FLX-121', '## Product Vision', '## Product Boundaries (scope guard)', '## Parent Objective', '## Project', '## The Issue Contract', '## Linked Repositories', '## Legal Next Statuses'].every((s, i, arr) => {
  const idx = pkg.indexOf(s);
  return idx >= 0 && (i === 0 || idx > pkg.indexOf(arr[i - 1]));
}), pkg.slice(0, 200));
check('parent objective is the FLX-102 epic', pkg.includes('FLX-102'));
check('vision brief injected', pkg.includes('Issues are executable contracts'));
check('boundaries scope guard injected', pkg.includes('Not a CI system'));
check('linked repo with scope present', pkg.includes('fluxion-core') && pkg.includes('whole repo'));
const h2 = await call('hydrate_issue_context', { identifier: 'FLX-121' });
check('deterministic: byte-identical on repeat', textOf(h2) === pkg);
// partial degradation: scratch issue with no parent/product docs
const orphan = await call('create_issue', { title: '[SCRATCH] hydrator orphan', productSlug: scratchSlug ? undefined : undefined });
const orphanId = textOf(orphan).match(/FLX-\d+/)?.[0];
const h3 = await call('hydrate_issue_context', { identifier: orphanId });
check('partial package degrades with markers', textOf(h3).includes('(root issue — no parent)') && !h3.error);
const h4 = await call('hydrate_issue_context', { identifier: 'FLX-99999' });
check('unknown issue errors', !!h4.error);
await prisma.issue.deleteMany({ where: { identifier: orphanId ?? '' } });

// --- 10. Fionn M2: Goal Tree Integrity (FLX-122) ---
console.log('\n10. decompose_issue + cycle guard');
const epicRes = await call('create_issue', { title: '[SCRATCH] decompose epic', productSlug: 'FLX' });
const epicId = textOf(epicRes).match(/FLX-\d+/)?.[0];
const dec = await call('decompose_issue', {
  parentIdentifier: epicId,
  children: [
    { title: '[SCRATCH] dec child 1', acceptanceCriteria: '- a' },
    { title: '[SCRATCH] dec child 2', priority: 'High' },
    { title: '[SCRATCH] dec child 3' },
  ],
});
const decIds = textOf(dec).match(/FLX-\d+/g)?.slice(1) ?? [];
check('decomposes into 3 children atomically', decIds.length === 3, textOf(dec));
const epicFull = JSON.parse(textOf(await call('read_issue', { identifier: epicId })));
check('children linked under parent', epicFull.children.length === 3);
check('children inherit product namespace', decIds.every((i) => i.startsWith('FLX-')));

// atomic rollback: second child invalid -> nothing created
const before = await prisma.issue.count({ where: { title: { startsWith: '[SCRATCH] rollback' } } });
const bad = await call('decompose_issue', {
  parentIdentifier: epicId,
  children: [{ title: '[SCRATCH] rollback 1' }, { title: '[SCRATCH] rollback 2', status: 'Banana' }],
});
const after = await prisma.issue.count({ where: { title: { startsWith: '[SCRATCH] rollback' } } });
check('invalid child rejects the whole batch', !!bad.error, JSON.stringify(bad.error ?? bad));
check('rollback leaves no partial children', before === after, `before ${before}, after ${after}`);

// cycle guard: epic -> child1 exists; making epic a child of its grandchild must fail
const grand = await call('decompose_issue', { parentIdentifier: decIds[0], children: [{ title: '[SCRATCH] dec grandchild' }] });
const grandId = textOf(grand).match(/FLX-\d+/g)?.slice(1)?.[0];
const cyc = await call('update_issue', { identifier: epicId, parentIdentifier: grandId });
check('deep cycle rejected with chain in error', !!cyc.error && cyc.error.message.includes('cycle'), JSON.stringify(cyc.error ?? cyc));
const selfCyc = await call('update_issue', { identifier: epicId, parentIdentifier: epicId });
check('self-parent still rejected', !!selfCyc.error);
await prisma.issue.deleteMany({ where: { title: { startsWith: '[SCRATCH] dec' } } });

// --- Cleanup ---
await prisma.issue.deleteMany({ where: { identifier: { in: [scratchId, childId, parentId2].filter(Boolean) } } });
await prisma.document.deleteMany({ where: { title: { startsWith: '[SCRATCH]' } } });
await prisma.changeLog.deleteMany({ where: { description: { startsWith: '[SCRATCH]' } } });
await prisma.project.deleteMany({ where: { name: { startsWith: '[SCRATCH]' } } });
if (scratchSlug) await prisma.product.delete({ where: { slug: scratchSlug } });
console.log('\nScratch entities cleaned up.');

await prisma.$disconnect();
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
