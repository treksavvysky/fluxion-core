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
check('37 tools listed', names.length === 37, `got ${names.length}: ${names.join(', ')}`);
for (const t of ['update_issue', 'search', 'read_product_metrics', 'archive_product', 'update_product_status', 'read_document', 'write_document', 'create_change_log', 'query_telemetry', 'read_issue', 'read_project', 'read_governing_context', 'hydrate_issue_context', 'decompose_issue', 'check_criterion', 'read_cycle', 'create_cycle', 'update_cycle_status', 'update_project_status', 'brief_pcp_packet', 'refingerprint_pcp_packet', 'read_product_commits', 'update_repository', 'archive_repository']) {
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

// --- 8b. update_project_status (FLX-135) ---
console.log('\n8b. update_project_status');
const cpPlanned = await call('create_project', { name: '[SCRATCH] Planned Project', status: 'Planned' });
const plannedSlug = textOf(cpPlanned).match(/slug ([a-z0-9-]+)/)?.[1];
check('create project as Planned', !!plannedSlug && textOf(cpPlanned).includes('Planned'), textOf(cpPlanned));
const plannedProj = await prisma.project.findUnique({ where: { slug: plannedSlug } });

// Try to transition to Active -> should fail because Charter, Design, Risk are missing
const actFail = await call('update_project_status', { projectId: plannedProj.id, status: 'Active' });
check('transition to Active fails without required docs', !!actFail.error && actFail.error.message.includes('missing required documents'), JSON.stringify(actFail));

// Write Charter, Design, Risk docs
await call('write_document', { title: '[SCRATCH] Project Charter', content: 'charter content', docType: 'Charter', projectId: plannedProj.id });
await call('write_document', { title: '[SCRATCH] Project Design Brief', content: 'design content', docType: 'Design', projectId: plannedProj.id });
await call('write_document', { title: '[SCRATCH] Project Risk Register', content: 'risk content', docType: 'Risk', projectId: plannedProj.id });

// Try to transition to Active -> should succeed now
const actOk = await call('update_project_status', { projectId: plannedProj.id, status: 'Active' });
check('transition to Active succeeds with required docs', textOf(actOk).includes('Active'), JSON.stringify(actOk));

// Try to transition to Completed -> should fail because Retrospective is missing
const compFail = await call('update_project_status', { projectId: plannedProj.id, status: 'Completed' });
check('transition to Completed fails without Retrospective', !!compFail.error && compFail.error.message.includes('missing required documents'), JSON.stringify(compFail));

// Write Retrospective doc
await call('write_document', { title: '[SCRATCH] Project Retrospective', content: 'retro content', docType: 'Retrospective', projectId: plannedProj.id });

// Try to transition to Completed -> should succeed now (0 issues is 0 open issues)
const compOk = await call('update_project_status', { projectId: plannedProj.id, status: 'Completed' });
check('transition to Completed succeeds with Retrospective', textOf(compOk).includes('Completed'), JSON.stringify(compOk));

// Reopen to Active (legal transition Completed -> Active)
const reopenOk = await call('update_project_status', { projectId: plannedProj.id, status: 'Active' });
check('reopen to Active succeeds', textOf(reopenOk).includes('Active'), JSON.stringify(reopenOk));

// Create an open issue for the project to test completed work gate
const testIssue = await prisma.issue.create({
  data: {
    identifier: 'FLX-SCR-999',
    title: '[SCRATCH] Project open issue test',
    status: 'Todo',
    priority: 'Low',
    projectId: plannedProj.id,
    productId: plannedProj.productId
  }
});

// Try to transition to Completed -> should fail due to open issue
const compFailIssue = await call('update_project_status', { projectId: plannedProj.id, status: 'Completed' });
check('transition to Completed fails with open issues', !!compFailIssue.error && compFailIssue.error.message.includes('open issues'), JSON.stringify(compFailIssue));

// Resolve the issue (mark as Done)
await prisma.issue.update({
  where: { id: testIssue.id },
  data: { status: 'Done' }
});

// Try to transition to Completed -> should succeed now
const compOk2 = await call('update_project_status', { projectId: plannedProj.id, status: 'Completed' });
check('transition to Completed succeeds after resolving issues', textOf(compOk2).includes('Completed'), JSON.stringify(compOk2));

// Cleanup test project and issue
await prisma.issue.deleteMany({ where: { identifier: 'FLX-SCR-999' } });
await prisma.document.deleteMany({ where: { projectId: plannedProj.id } });
await prisma.project.delete({ where: { id: plannedProj.id } });

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

// --- 11. Fionn M3: Verification Gatekeeper (FLX-123) ---
console.log('\n11. check_criterion + Done gate');
const gated = await call('create_issue', {
  title: '[SCRATCH] gated issue',
  status: 'In Progress',
  acceptanceCriteria: '- [ ] tests pass\n- [ ] zero type errors\nProse note that is not a checkbox.',
});
const gatedId = textOf(gated).match(/FLX-\d+/)?.[0];
const blocked = await call('update_issue', { identifier: gatedId, status: 'Done' });
check('Done blocked with open criteria listed', !!blocked.error && blocked.error.message.includes('unattested') && blocked.error.message.includes('tests pass'), JSON.stringify(blocked.error ?? blocked));
const att0 = await call('check_criterion', { identifier: gatedId, criterionIndex: 0, evidence: 'ran suite: ALL CHECKS PASSED', attestor: 'suite' });
check('first attestation recorded, one remains', textOf(att0).includes('1 criteria remain'), textOf(att0));
const stillBlocked = await call('update_issue', { identifier: gatedId, status: 'Done' });
check('Done still blocked with one open', !!stillBlocked.error && stillBlocked.error.message.includes('zero type errors'));
const att1 = await call('check_criterion', { identifier: gatedId, criterionIndex: 1, evidence: 'tsc --noEmit clean', attestor: 'suite' });
check('final attestation unlocks Done', textOf(att1).includes('Done transition is unlocked'), textOf(att1));
const rGated = JSON.parse(textOf(await call('read_issue', { identifier: gatedId })));
check('read_issue exposes checklist with attestations', rGated.checklist?.length === 2 && rGated.checklist.every((c) => c.attested));
const nowDone = await call('update_issue', { identifier: gatedId, status: 'Done' });
check('Done allowed after full attestation', textOf(nowDone).includes('status'), JSON.stringify(nowDone));
// editing a criterion invalidates its attestation
await call('update_issue', { identifier: gatedId, status: 'In Progress' });
await call('update_issue', { identifier: gatedId, acceptanceCriteria: '- [ ] tests pass\n- [ ] zero LINT errors' });
const reBlocked = await call('update_issue', { identifier: gatedId, status: 'Done' });
check('edited criterion invalidates stale attestation', !!reBlocked.error && reBlocked.error.message.includes('zero LINT errors'), JSON.stringify(reBlocked.error ?? reBlocked));
const noBox = await call('check_criterion', { identifier: scratchId, criterionIndex: 0, evidence: 'x' });
check('issues without checkboxes have no checklist to attest', !!noBox.error);
const hGated = await call('hydrate_issue_context', { identifier: gatedId });
check('hydrator annotates checklist state', textOf(hGated).includes('- [x] tests pass') && textOf(hGated).includes('- [ ] zero LINT errors'));
await prisma.issue.deleteMany({ where: { identifier: gatedId ?? '' } });

// --- 12. Fionn M4: Triage dedup on cicd webhook (FLX-124) ---
console.log('\n12. webhook signature dedup');
const cicd = (payload) => fetch(`${BASE_URL}/api/webhooks/cicd`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
  body: JSON.stringify({ status: 'failure', ...payload }),
}).then(r => r.json());
const sig1 = await cicd({ service: 'scratch-dedup-svc', description: 'Error 137: OOM during build at 2026-06-13T10:00:00Z run 4413' });
check('first signal files a Triage issue', !!sig1.ingestedIssue?.identifier, JSON.stringify(sig1).slice(0, 150));
const dedupIssueId = sig1.ingestedIssue?.identifier;
const sig2 = await cicd({ service: 'scratch-dedup-svc', description: 'Error 137: OOM during build at 2026-06-13T11:37:22Z run 9981' });
check('identical signal (different timestamps/run ids) dedupes', sig2.deduplicated === true && sig2.issue === dedupIssueId && sig2.occurrences === 2, JSON.stringify(sig2));
const sig3 = await cicd({ service: 'scratch-dedup-svc', description: 'TypeError: cannot read properties of undefined' });
check('distinct error files a new issue', !!sig3.ingestedIssue?.identifier && sig3.ingestedIssue.identifier !== dedupIssueId, JSON.stringify(sig3).slice(0, 150));
// closed issues do not absorb: close the first, resend, expect a NEW issue referencing it
await call('update_issue', { identifier: dedupIssueId, status: 'Cancelled' });
const sig4 = await cicd({ service: 'scratch-dedup-svc', description: 'Error 137: OOM during build at 2026-06-13T12:00:00Z run 777' });
check('closed issue not silently absorbed; new issue references prior', !!sig4.ingestedIssue?.identifier && sig4.ingestedIssue.identifier !== dedupIssueId && sig4.ingestedIssue.context?.includes(dedupIssueId), JSON.stringify(sig4).slice(0, 200));
await prisma.issue.deleteMany({ where: { title: { contains: 'scratch-dedup-svc' } } });

// --- 13. Cycle Management Tools ---
console.log('\n13. Cycle tools: read_cycles, create_cycle, read_cycle, update_cycle_status');
const c1 = await call('create_cycle', {
  name: '[SCRATCH] Cycle Alpha',
  startDate: '2026-07-01',
  endDate: '2026-07-14',
  goal: 'Deploy initial sprint objectives',
  capacityPoints: 15,
  status: 'Planned'
});
const c1res = textOf(c1).match(/with slug ([a-z0-9-]+)/)?.[1];
check('create_cycle works', !!c1res, textOf(c1));

if (c1res) {
  const c2 = await call('read_cycle', { cycleSlug: c1res });
  const c2res = JSON.parse(textOf(c2));
  check('read_cycle works and returns goal', c2res?.goal === 'Deploy initial sprint objectives', textOf(c2));

  const c3 = await call('update_cycle_status', { cycleSlug: c1res, status: 'Active' });
  const success = textOf(c3).includes('Active') || (c3.error && c3.error.message.includes('already Active'));
  check('update_cycle_status to Active checks status or conflict correctly', !!success, JSON.stringify(c3.error ?? c3));

  // cleanup cycle
  await prisma.cycle.delete({ where: { slug: c1res } });
}

// --- 14. PCP v0.2 Git Branch Handoff tools (FLX-134) ---
console.log('\n14. brief_pcp_packet + refingerprint_pcp_packet');
// Non-ASCII content pins ensure_ascii parity with pcp-server's validate.py;
// the fingerprint constant below was computed by the Python reference.
const pcpPacket = {
  protocol: 'pcp', name: 'Project Context Protocol', version: '0.2.0', packet_type: 'project_context',
  project: { name: 'törture — café ✅ 🚀', purpose: 'quotes " backslash \\ newline \n tab \t del \x7f' },
  current_objective: { title: 'ünïcode', definition_of_done: ['emoji 🎯', 'plain'] },
  fingerprint: '53fd20db4adfc61ed86656d6afe081716cbd4c4ee1fa5ed0d8a3877202d384de',
};
const pb1 = await call('brief_pcp_packet', { content: JSON.stringify(pcpPacket) });
check('valid packet briefs (fingerprint parity with validate.py)', textOf(pb1).startsWith('# PCP Briefing —') && textOf(pb1).includes('ünïcode'), JSON.stringify(pb1.error ?? '').slice(0, 300));
const pb2 = await call('brief_pcp_packet', { content: JSON.stringify({ ...pcpPacket, fingerprint: 'deadbeef' }) });
check('tampered fingerprint refused', !!pb2.error && pb2.error.message.includes('fingerprint mismatch'), JSON.stringify(pb2.error ?? pb2));
const pb3 = await call('brief_pcp_packet', { content: JSON.stringify({ ...pcpPacket, rogue_field: true }) });
check('schema violation refused (additionalProperties)', !!pb3.error && pb3.error.message.includes('rogue_field'), JSON.stringify(pb3.error ?? pb3));
const pb4 = await call('brief_pcp_packet', { content: '{not json' });
check('malformed JSON refused', !!pb4.error && pb4.error.message.includes('not valid JSON'));

const updated = { ...pcpPacket, evaluation: { status: 'completed', reason: 'objective shipped' } };
const rf1 = await call('refingerprint_pcp_packet', { content: JSON.stringify(updated), updatedAt: '2026-07-05T00:00:00Z' });
const rf1res = JSON.parse(textOf(rf1));
check('refingerprint returns new fingerprint + updated_at + file content', rf1res.fingerprint?.length === 64 && rf1res.fingerprint !== pcpPacket.fingerprint && rf1res.updated_at === '2026-07-05T00:00:00Z' && rf1res.fileContent?.endsWith('\n'), textOf(rf1).slice(0, 200));
const pb5 = await call('brief_pcp_packet', { content: rf1res.fileContent });
check('refingerprinted file content round-trips through brief', textOf(pb5).includes('Status: completed'), JSON.stringify(pb5.error ?? '').slice(0, 300));
const rf2 = await call('refingerprint_pcp_packet', { content: rf1res.fileContent, updatedAt: '2026-07-05T00:00:00Z' });
check('refingerprint is idempotent for fixed updatedAt', JSON.parse(textOf(rf2)).fingerprint === rf1res.fingerprint);
const rf3 = await call('refingerprint_pcp_packet', { content: JSON.stringify({ protocol: 'pcp' }) });
check('refingerprint validates schema first', !!rf3.error && rf3.error.message.includes('missing required'), JSON.stringify(rf3.error ?? rf3));

// --- 15. Per-agent key identity attribution (FLX-133) ---
console.log('\n15. per-agent keys: server-stamped attribution');
const agentRegistry = (() => { try { return JSON.parse(process.env.FLUXION_AGENT_KEYS ?? ''); } catch { return null; } })();
if (!agentRegistry || Object.keys(agentRegistry).length === 0) {
  check('FLUXION_AGENT_KEYS configured (skipping section 15)', false, 'set FLUXION_AGENT_KEYS to run identity attribution checks');
} else {
  const [agentIdentity, agentKey] = Object.entries(agentRegistry)[0];
  const agentRpc = async (method, params) => {
    const res = await fetch(`${BASE_URL}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': agentKey },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
    return res.json();
  };
  const agentCall = (name, args) => agentRpc('tools/call', { name, arguments: args });

  // unknown key still refused (fail closed preserved)
  const badAuth = await fetch(`${BASE_URL}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'not-a-real-key' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/list' }),
  });
  check('unknown key rejected with 401', badAuth.status === 401);
  const agentList = await agentRpc('tools/list');
  check('agent key authenticates', (agentList?.result?.tools ?? []).length > 0);

  // attestor is stamped from the key when omitted
  const attIssue = await agentCall('create_issue', { title: '[SCRATCH] identity attestation target', status: 'In Progress', acceptanceCriteria: '- [ ] stamped' });
  const attId = textOf(attIssue).match(/FLX-\d+/)?.[0];
  await agentCall('check_criterion', { identifier: attId, criterionIndex: 0, evidence: 'identity stamping e2e' });
  const attRow = await prisma.criterionAttestation.findFirst({ where: { issue: { identifier: attId } } });
  check('omitted attestor stamped with key identity', attRow?.attestor === agentIdentity, `got "${attRow?.attestor}", want "${agentIdentity}"`);

  // impersonation is refused; own identity (exact) accepted
  const imp = await agentCall('check_criterion', { identifier: attId, criterionIndex: 0, evidence: 'x', attestor: 'George Loudon' });
  check('mismatching attestor refused with identity named', !!imp.error && imp.error.message.includes(agentIdentity), JSON.stringify(imp.error ?? imp));
  const own = await agentCall('check_criterion', { identifier: attId, criterionIndex: 0, evidence: 'explicit own identity', attestor: agentIdentity });
  check('matching attestor accepted', textOf(own).includes('Attested'), JSON.stringify(own.error ?? ''));

  // create_change_log: implementedBy stamped when omitted, impersonation refused
  const cl = await agentCall('create_change_log', { type: 'Annotation', description: '[SCRATCH] identity stamp check', approvedBy: `${agentIdentity} (autonomous)` });
  check('change log accepted without implementedBy', textOf(cl).includes('Successfully registered'), JSON.stringify(cl.error ?? ''));
  const clRow = await prisma.changeLog.findFirst({ where: { description: '[SCRATCH] identity stamp check' } });
  check('implementedBy stamped with key identity', clRow?.implementedBy === agentIdentity, `got "${clRow?.implementedBy}"`);
  const clImp = await agentCall('create_change_log', { type: 'Annotation', description: '[SCRATCH] impersonation', approvedBy: 'x', implementedBy: 'Codex@somewhere-else' });
  check('mismatching implementedBy refused', !!clImp.error && clImp.error.message.includes('impersonation is refused'), JSON.stringify(clImp.error ?? clImp));

  // actor gap closed: identity-keyed create/update leave an audit trail
  const acts = await prisma.activityLog.findMany({ where: { target: attId, actor: agentIdentity } });
  check('create_issue left identity-attributed activity entry', acts.some((a) => a.action.startsWith('Created issue')), JSON.stringify(acts.map((a) => a.action)));
  await agentCall('update_status', { issueId: attRow.issueId, status: 'Done' });
  const acts2 = await prisma.activityLog.findMany({ where: { target: attId, actor: agentIdentity } });
  check('update_status left identity-attributed activity entry', acts2.some((a) => a.action.includes('-> Done')), JSON.stringify(acts2.map((a) => a.action)));

  // legacy shared key: behavior unchanged (free-text attestor still trusted)
  const legacyIssue = await call('create_issue', { title: '[SCRATCH] legacy key target', status: 'In Progress', acceptanceCriteria: '- [ ] legacy' });
  const legacyId = textOf(legacyIssue).match(/FLX-\d+/)?.[0];
  const legacyAtt = await call('check_criterion', { identifier: legacyId, criterionIndex: 0, evidence: 'legacy path', attestor: 'suite' });
  check('legacy key keeps trusted free-text attestor', textOf(legacyAtt).includes('Attested'), JSON.stringify(legacyAtt.error ?? ''));
  const legacyActs = await prisma.activityLog.findMany({ where: { target: legacyId ?? '' } });
  check('legacy key writes no actor-gap entries', !legacyActs.some((a) => a.action.startsWith('Created issue')), JSON.stringify(legacyActs.map((a) => a.action)));

  await prisma.issue.deleteMany({ where: { identifier: { in: [attId, legacyId].filter(Boolean) } } });
  await prisma.activityLog.deleteMany({ where: { target: { in: [attId, legacyId].filter(Boolean) } } });
}

// --- 16. Commit-diff -> product routing (FLX-119) ---
console.log('\n16. push ingest + pathFilter routing');
{
  const prodA = await prisma.product.create({ data: { slug: `SCR-RT-A-${Date.now()}`, name: '[SCRATCH] Route Target A' } });
  const prodB = await prisma.product.create({ data: { slug: `SCR-RT-B-${Date.now()}`, name: '[SCRATCH] Route Target B' } });
  const monoRepo = await prisma.repository.create({ data: { name: `scratch-mono-${Date.now()}`, productId: prodB.id } });
  await prisma.productRepository.create({ data: { productId: prodA.id, repositoryId: monoRepo.id, pathFilter: 'services/auth/*' } });

  const pushUrl = (token) => `${BASE_URL}/api/webhooks/push${token ? `?token=${token}` : ''}`;
  const ghPayload = {
    ref: 'refs/heads/master',
    repository: { name: monoRepo.name, html_url: 'https://example.test/mono' },
    commits: [
      { id: 'aaa111', message: 'auth: nested + direct paths', author: { name: 'suite' }, timestamp: '2026-07-05T10:00:00Z', added: ['services/auth/login.ts'], modified: ['services/auth/deep/nested.ts'], removed: [] },
      { id: 'bbb222', message: 'docs only', author: { name: 'suite' }, added: [], modified: ['README.md'], removed: [] },
      { id: 'ccc333', message: 'spans two products', author: { name: 'suite' }, added: ['services/auth/mfa.ts'], modified: ['docs/guide.md'], removed: [] },
    ],
  };

  const noAuth = await fetch(pushUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ghPayload) });
  check('push without key rejected 401', noAuth.status === 401);
  const ingest = await fetch(pushUrl(API_KEY), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ghPayload) }).then((r) => r.json());
  check('GitHub payload ingested (3 commits)', ingest.success === true && ingest.recorded?.length === 3, JSON.stringify(ingest).slice(0, 200));

  const rcA = JSON.parse(textOf(await call('read_product_commits', { productSlug: prodA.slug })));
  const rcB = JSON.parse(textOf(await call('read_product_commits', { productSlug: prodB.slug })));
  const shasA = rcA.commits.map((c) => c.sha).sort();
  const shasB = rcB.commits.map((c) => c.sha).sort();
  check('pathFilter routes auth commits to product A (trailing /* recursive)', shasA.join(',') === 'aaa111,ccc333', JSON.stringify(rcA.commits));
  check('nested path matched by trailing /*', rcA.commits.find((c) => c.sha === 'aaa111')?.matchedPaths.includes('services/auth/deep/nested.ts'));
  check('unmatched paths fall back to repo default product B', shasB.join(',') === 'bbb222,ccc333', JSON.stringify(rcB.commits));
  const span = rcB.commits.find((c) => c.sha === 'ccc333');
  check('spanning commit routes to B only with leftover paths', span?.via === 'repoDefault' && span?.matchedPaths.join(',') === 'docs/guide.md', JSON.stringify(span));

  const redeliver = await fetch(pushUrl(API_KEY), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ghPayload) }).then((r) => r.json());
  check('re-delivery is idempotent (3 duplicates, 0 recorded)', redeliver.duplicates?.length === 3 && redeliver.recorded?.length === 0, JSON.stringify(redeliver).slice(0, 150));

  // single-repo (no pathFilter links): everything routes to the direct product
  const soloRepo = await prisma.repository.create({ data: { name: `scratch-solo-${Date.now()}`, productId: prodA.id } });
  const soloIngest = await fetch(pushUrl(API_KEY), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoName: soloRepo.name, branch: 'master', commits: [{ sha: 'ddd444', message: 'local fallback shape', paths: ['src/index.ts', 'package.json'] }] }),
  }).then((r) => r.json());
  check('local fallback payload shape accepted', soloIngest.success === true && soloIngest.recorded?.length === 1, JSON.stringify(soloIngest).slice(0, 150));
  const rcA2 = JSON.parse(textOf(await call('read_product_commits', { productSlug: prodA.slug })));
  const solo = rcA2.commits.find((c) => c.sha === 'ddd444');
  check('single-repo commit routes whole diff to direct product', solo?.via === 'repoDefault' && solo?.matchedPaths.length === 2, JSON.stringify(solo));

  await prisma.commit.deleteMany({ where: { repoId: { in: [monoRepo.id, soloRepo.id] } } });
  await prisma.repository.deleteMany({ where: { id: { in: [monoRepo.id, soloRepo.id] } } });
  await prisma.product.deleteMany({ where: { id: { in: [prodA.id, prodB.id] } } });
}

// --- 17. update_repository (FLX-136) ---
console.log('\n17. update_repository');
{
  const prodX = await prisma.product.create({ data: { slug: `SCR-UR-${Date.now()}`, name: '[SCRATCH] Repo Home' } });
  const repoName = `scratch-mutable-${Date.now()}`;
  await call('create_repository', { name: repoName });
  const created = await prisma.repository.findFirst({ where: { name: repoName } });
  check('scratch repo created without url/product', created && created.url === null && created.productId === null);

  // backfill url + re-home by unambiguous name (the fionn_ai scenario)
  const u1 = await call('update_repository', { repoName, url: 'https://example.test/mutable', productSlug: prodX.slug });
  check('update by name backfills url + product', textOf(u1).includes('url, productId') || (textOf(u1).includes('url') && textOf(u1).includes('productId')), JSON.stringify(u1.error ?? u1));
  const afterU1 = await prisma.repository.findUnique({ where: { id: created.id } });
  check('url and product persisted', afterU1?.url === 'https://example.test/mutable' && afterU1?.productId === prodX.id);

  // rename by UUID, detach product and clear url with the "none" sentinel
  const u2 = await call('update_repository', { repoId: created.id, name: `${repoName}-renamed`, url: 'none', productId: 'none' });
  check('rename + detach via none sentinels', !u2.error, JSON.stringify(u2.error ?? ''));
  const afterU2 = await prisma.repository.findUnique({ where: { id: created.id } });
  check('rename/detach persisted', afterU2?.name === `${repoName}-renamed` && afterU2?.url === null && afterU2?.productId === null);

  // error surface
  const e1 = await call('update_repository', { repoId: 'nope-123', name: 'x' });
  check('unknown repoId rejected', !!e1.error && e1.error.message.includes('not found'), JSON.stringify(e1.error ?? e1));
  const e2 = await call('update_repository', { repoName: `${repoName}-renamed`, productId: 'nope-456' });
  check('unknown productId rejected', !!e2.error && e2.error.message.includes('Product not found'), JSON.stringify(e2.error ?? e2));
  const e3 = await call('update_repository', { repoId: created.id });
  check('no-fields call rejected', !!e3.error && e3.error.message.includes('No updatable fields'));
  const e4 = await call('update_repository', { name: 'x' });
  check('missing identifier rejected', !!e4.error && e4.error.message.includes('repoId or repoName'));

  // ambiguous name refused
  const twinA = await prisma.repository.create({ data: { name: `scratch-twin-${Date.now()}` } });
  const twinB = await prisma.repository.create({ data: { name: twinA.name.toUpperCase() } });
  const e5 = await call('update_repository', { repoName: twinA.name, url: 'https://x' });
  check('ambiguous name refused with candidates listed', !!e5.error && e5.error.message.includes('ambiguous'), JSON.stringify(e5.error ?? e5));

  await prisma.repository.deleteMany({ where: { id: { in: [created.id, twinA.id, twinB.id] } } });
  await prisma.product.delete({ where: { id: prodX.id } });
}

// --- 18. archive_repository soft-delete (FLX-137) ---
console.log('\n18. archive_repository: soft-delete, restore, exclusion, webhook behavior');
{
  const arcName = `scratch-arc-${Date.now()}`;
  await call('create_repository', { name: arcName });
  const arcRepo = await prisma.repository.findFirst({ where: { name: arcName } });
  // give it history: one linked issue
  const histIssue = await call('create_issue', { title: '[SCRATCH] archived repo history' });
  const histId = textOf(histIssue).match(/FLX-\d+/)?.[0];
  const histRow = await prisma.issue.findUnique({ where: { identifier: histId } });
  await prisma.issue.update({ where: { id: histRow.id }, data: { repoId: arcRepo.id } });

  const a1 = await call('archive_repository', { repoName: arcName });
  check('archive by name', textOf(a1).includes('Successfully archived'), JSON.stringify(a1.error ?? a1));
  const a2 = await call('archive_repository', { repoId: arcRepo.id });
  check('idempotent re-archive distinct message', textOf(a2).includes('already archived'), textOf(a2));

  const listDefault = JSON.parse(textOf(await call('read_repositories', {})));
  check('archived excluded from default listing', !listDefault.some((r) => r.id === arcRepo.id));
  const listAll = JSON.parse(textOf(await call('read_repositories', { includeArchived: true })));
  check('includeArchived lists it with archivedAt set', listAll.some((r) => r.id === arcRepo.id && r.archivedAt !== null));

  // history preserved and queryable
  const stillLinked = await prisma.issue.findUnique({ where: { id: histRow.id }, include: { repo: true } });
  check('linked issue history intact after archive', stillLinked?.repo?.id === arcRepo.id && stillLinked.repo.archivedAt !== null);

  // webhook signals on an archived repo: match, no duplicate, no resurrect
  const pushRes = await fetch(`${BASE_URL}/api/webhooks/push?token=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoName: arcName, branch: 'master', commits: [{ sha: 'arc111', message: 'signal on archived', paths: ['a.ts'] }] }),
  }).then((r) => r.json());
  const sameNameCount = await prisma.repository.count({ where: { name: { equals: arcName, mode: 'insensitive' } } });
  const afterPush = await prisma.repository.findUnique({ where: { id: arcRepo.id } });
  check('push on archived repo records commit without duplicate record', pushRes.recorded?.length === 1 && sameNameCount === 1, JSON.stringify(pushRes).slice(0, 150));
  check('push does not silently unarchive', afterPush?.archivedAt !== null);

  const r1 = await call('archive_repository', { repoName: arcName, restore: true });
  check('restore works', textOf(r1).includes('Successfully restored'), textOf(r1));
  const r2 = await call('archive_repository', { repoName: arcName, restore: true });
  check('idempotent re-restore distinct message', textOf(r2).includes('nothing to restore'), textOf(r2));
  const backDefault = JSON.parse(textOf(await call('read_repositories', {})));
  check('restored repo back in default listing', backDefault.some((r) => r.id === arcRepo.id));

  await prisma.issue.deleteMany({ where: { id: histRow.id } });
  await prisma.commit.deleteMany({ where: { repoId: arcRepo.id } });
  await prisma.repository.delete({ where: { id: arcRepo.id } });
}

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
