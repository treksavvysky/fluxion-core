// FLX-149: per-key capability tiers and the LIFE personal-domain fence, end to end over the
// stateless MCP endpoint and the REST routes.
//
// Run ONLY against a scratch instance (throwaway database) started with these test identities:
//   FLUXION_API_KEY=legacy-test-key
//   FLUXION_AGENT_KEYS='{"Full@test":"k-full","Fionn@test":"k-fionn","Gateway@test":"k-gw","Reader@test":"k-reader",
//                        "Writer@test":"k-writer","Closer@test":"k-closer","Bad@test":"k-bad"}'
//   FLUXION_AGENT_ACCESS='{"Fionn@test":{"tier":"full","personal":true},"Gateway@test":{"tier":"read","personal":true},
//                          "Reader@test":{"tier":"read"},"Writer@test":{"tier":"write"},"Closer@test":{"tier":"close"},
//                          "Bad@test":{"tier":"admin"}}'
// Against any other instance the test keys are refused and the script stops before writing.
//
// Usage: node scripts/test-key-tiers.mjs [baseUrl]   (default http://localhost:3092)

const BASE_URL = process.argv[2] || 'http://localhost:3092';
const KEYS = {
  legacy: 'legacy-test-key', full: 'k-full', fionn: 'k-fionn', gateway: 'k-gw',
  reader: 'k-reader', writer: 'k-writer', closer: 'k-closer', bad: 'k-bad',
};

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${condition || !detail ? '' : ` — ${detail}`}`);
}

let rpcId = 0;
async function rpc(key, method, params) {
  const res = await fetch(`${BASE_URL}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const call = async (key, name, args = {}) => (await rpc(key, 'tools/call', { name, arguments: args })).body;
const textOf = (r) => r?.result?.content?.[0]?.text ?? '';
const errOf = (r) => r?.error?.message ?? (r?.result?.isError ? textOf(r) : '');
const names = async (key) => ((await rpc(key, 'tools/list')).body?.result?.tools ?? []).map((t) => t.name);
const json = (r) => JSON.parse(textOf(r));
const ok = (r) => !r?.error && !r?.result?.isError;

// --- 0. Scratch-instance guard ---
console.log('0. scratch-instance guard');
const probe = await rpc(KEYS.fionn, 'tools/list');
if (probe.status !== 200) {
  console.error(`Test identity refused (HTTP ${probe.status}): this is not the scratch instance. Stopping before any write.`);
  process.exit(1);
}
check('test identities accepted', true);

// --- Setup (Fionn@test: full tier, personal) ---
console.log('\nSetup');
const MARK = `tiermark${Date.now()}`;
const products = json(await call(KEYS.fionn, 'read_products'));
if (!products.some((p) => p.slug === 'LIFE')) await call(KEYS.fionn, 'create_product', { name: 'Life' });
await call(KEYS.fionn, 'create_product', { name: `Tiers ${MARK}` });
const all = json(await call(KEYS.fionn, 'read_products'));
const life = all.find((p) => p.slug === 'LIFE');
const dev = all.find((p) => p.name === `Tiers ${MARK}`);
check('LIFE and a dev product exist', !!life && !!dev);
const mk = async (productSlug, title) => textOf(await call(KEYS.fionn, 'create_issue', { productSlug, title, status: 'Todo' })).match(/issue (\S+):/)?.[1];
const lifeIssue = await mk('LIFE', `${MARK} personal item`);
const devIssue = await mk(dev.slug, `${MARK} engineering item`);
check('issues created in LIFE and dev', /^LIFE-\d+$/.test(lifeIssue ?? '') && !!devIssue, `${lifeIssue} ${devIssue}`);
const lifeRow = json(await call(KEYS.fionn, 'read_issue', { identifier: lifeIssue }));
const devRow = json(await call(KEYS.fionn, 'read_issue', { identifier: devIssue }));
await call(KEYS.fionn, 'write_document', { title: `${MARK} life doc`, slug: `${MARK}-life-doc`, content: MARK, productId: life.id });
await call(KEYS.fionn, 'create_change_log', { type: 'Deployment', description: `${MARK} life log`, approvedBy: 'test', issueId: lifeRow.id });
const cycleText = textOf(await call(KEYS.fionn, 'create_cycle', { name: `Cycle ${MARK}`, startDate: '2026-11-01', endDate: '2026-11-14' }));
const cycles = json(await call(KEYS.fionn, 'read_cycles'));
const cycle = cycles.find((c) => c.name === `Cycle ${MARK}`);
check('cycle created', !!cycle, cycleText);
await call(KEYS.fionn, 'assign_issue_to_cycle', { issueId: lifeRow.id, cycleId: cycle.id });
await call(KEYS.fionn, 'assign_issue_to_cycle', { issueId: devRow.id, cycleId: cycle.id });

// --- 1. tools/list by tier ---
console.log('\n1. tools/list by tier');
const fullNames = await names(KEYS.full);
const readerNames = await names(KEYS.reader);
const writerNames = await names(KEYS.writer);
check('legacy and unlisted keys keep every tool', (await names(KEYS.legacy)).length === fullNames.length && fullNames.includes('write_document'));
check('read tier lists reads only', readerNames.includes('read_issue') && readerNames.includes('hydrate_issue_context') && !readerNames.some((n) => /^(create|update|write|archive|assign|decompose|check)_/.test(n)), readerNames.join(','));
check('write tier adds issue writes', ['create_issue', 'update_issue', 'update_status', 'check_criterion', 'create_change_log'].every((n) => writerNames.includes(n)));
check('write tier excludes governance', !['write_document', 'create_product', 'archive_product', 'update_cycle_status', 'create_project'].some((n) => writerNames.includes(n)));
check('malformed policy entry is refused', (await rpc(KEYS.bad, 'tools/list')).status === 401);

// --- 2. tools/call by tier ---
console.log('\n2. tools/call by tier');
check('read key cannot create an issue', /needs the write tier/.test(errOf(await call(KEYS.reader, 'create_issue', { title: 'x', productSlug: dev.slug }))));
const w1 = textOf(await call(KEYS.writer, 'create_issue', { title: `${MARK} by writer`, productSlug: dev.slug, status: 'Todo' })).match(/issue (\S+):/)?.[1];
check('write key creates an issue', !!w1);
const w1Row = json(await call(KEYS.writer, 'read_issue', { identifier: w1 }));
check('write key cannot create a closed issue', /needs the close tier/.test(errOf(await call(KEYS.writer, 'create_issue', { title: 'x', productSlug: dev.slug, status: 'Done' }))));
check('write key moves status forward', ok(await call(KEYS.writer, 'update_status', { issueId: w1Row.id, status: 'In Progress' })));
check('write key cannot cancel', /needs the close tier/.test(errOf(await call(KEYS.writer, 'update_status', { issueId: w1Row.id, status: 'Cancelled' }))));
check('write key cannot cancel through update_issue', /needs the close tier/.test(errOf(await call(KEYS.writer, 'update_issue', { identifier: w1, status: 'Cancelled' }))));
check('write key cannot decompose into closed children', /needs the close tier/.test(errOf(await call(KEYS.writer, 'decompose_issue', { parentIdentifier: w1, children: [{ title: 'c', status: 'Done' }] }))));
check('write key records a Deployment log', ok(await call(KEYS.writer, 'create_change_log', { type: 'Deployment', description: 'x', approvedBy: 'test' })));
check('write key cannot record a Decision', /needs the full tier/.test(errOf(await call(KEYS.writer, 'create_change_log', { type: 'Decision', description: 'x', approvedBy: 'test' }))));
check('write key cannot write a document', /needs the full tier/.test(errOf(await call(KEYS.writer, 'write_document', { title: 'x', content: 'x' }))));
check('close key cancels', ok(await call(KEYS.closer, 'update_status', { issueId: w1Row.id, status: 'Cancelled' })));

// --- 3. LIFE fence: keys without the personal flag ---
console.log('\n3. LIFE fence without the personal flag');
const FENCE = /may not access the LIFE product/;
const readerIssues = json(await call(KEYS.reader, 'read_issues')).map((i) => i.identifier);
check('read_issues leaves LIFE out, keeps the rest', !readerIssues.includes(lifeIssue) && readerIssues.includes(devIssue));
check('read_issues scoped to LIFE is refused', FENCE.test(errOf(await call(KEYS.reader, 'read_issues', { productSlug: 'life' }))));
check('read_issue refuses a LIFE issue', FENCE.test(errOf(await call(KEYS.reader, 'read_issue', { identifier: lifeIssue }))));
check('read_governing_context refuses a LIFE issue', FENCE.test(errOf(await call(KEYS.reader, 'read_governing_context', { issueId: lifeRow.id }))));
const s = json(await call(KEYS.reader, 'search', { query: MARK }));
check('search leaves out LIFE issues, documents and logs', !s.issues.some((i) => i.identifier === lifeIssue) && s.issues.some((i) => i.identifier === devIssue) && s.documents.length === 0 && s.changeLogs.length === 0, JSON.stringify(s));
check('read_products leaves LIFE out', !json(await call(KEYS.reader, 'read_products')).some((p) => p.slug === 'LIFE'));
check('read_product_briefs leaves LIFE out', !json(await call(KEYS.reader, 'read_product_briefs')).some((p) => p.slug === 'LIFE'));
check('read_product_briefs for LIFE is refused', FENCE.test(errOf(await call(KEYS.reader, 'read_product_briefs', { productSlug: 'LIFE' }))));
check('read_product_metrics for LIFE is refused', FENCE.test(errOf(await call(KEYS.reader, 'read_product_metrics', { productSlug: 'LIFE' }))));
const rc = json(await call(KEYS.reader, 'read_cycle', { cycleId: cycle.id }));
check('read_cycle leaves out LIFE issues', rc.issues.some((i) => i.identifier === devIssue) && !rc.issues.some((i) => i.identifier === lifeIssue));
check('read_document refuses a LIFE document', FENCE.test(errOf(await call(KEYS.reader, 'read_document', { slug: `${MARK}-life-doc` }))));
const act = json(await call(KEYS.reader, 'query_telemetry', { type: 'activities' })).activities;
check('query_telemetry leaves out LIFE activity', !act.some((a) => String(a.target).startsWith('LIFE-')));
check('legacy key has no personal access', FENCE.test(errOf(await call(KEYS.legacy, 'read_issue', { identifier: lifeIssue }))));
check('full key without the flag cannot create in LIFE', FENCE.test(errOf(await call(KEYS.full, 'create_issue', { title: 'x', productSlug: 'LIFE' }))));
check('full key without the flag cannot edit a LIFE issue', FENCE.test(errOf(await call(KEYS.full, 'update_issue', { identifier: lifeIssue, title: 'x' }))));
check('full key without the flag cannot move an issue into LIFE', FENCE.test(errOf(await call(KEYS.full, 'assign_issue_details', { issueId: devRow.id, productId: life.id }))));
check('full key without the flag cannot attach a child to a LIFE issue', FENCE.test(errOf(await call(KEYS.full, 'create_issue', { title: 'x', parentIdentifier: lifeIssue }))));

// --- 4. LIFE with the personal flag ---
console.log('\n4. LIFE with the personal flag');
check('read+personal key reads a LIFE issue', ok(await call(KEYS.gateway, 'read_issue', { identifier: lifeIssue })));
check('read+personal key sees LIFE in lists', json(await call(KEYS.gateway, 'read_issues')).some((i) => i.identifier === lifeIssue));
check('read+personal key still cannot write', /needs the write tier/.test(errOf(await call(KEYS.gateway, 'update_issue', { identifier: lifeIssue, title: 'x' }))));
check('hydration refuses LIFE for every key', /LIFE-namespace issue/.test(errOf(await call(KEYS.fionn, 'hydrate_issue_context', { identifier: lifeIssue }))));
check('full+personal key edits a LIFE issue', ok(await call(KEYS.fionn, 'update_issue', { identifier: lifeIssue, description: 'edited' })));

// --- 5. REST ---
console.log('\n5. REST');
const rest = (key, method, path, body) => fetch(`${BASE_URL}${path}`, {
  method, headers: { 'Content-Type': 'application/json', ...(key ? { 'x-api-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then((r) => r.status);
check('no key: 401', (await rest(null, 'POST', '/api/products', { name: 'x' })) === 401);
check('read key: POST is 403', (await rest(KEYS.reader, 'POST', '/api/products', { name: 'x' })) === 403);
check('write key: POST is 403', (await rest(KEYS.writer, 'POST', '/api/webhooks/telemetry', {})) === 403);
const fullPost = await rest(KEYS.full, 'POST', '/api/products', { name: `REST ${MARK}` });
check('full key: POST is not refused', fullPost !== 401 && fullPost !== 403, `HTTP ${fullPost}`);
check('read key: GET is allowed', ![401, 403].includes(await rest(KEYS.reader, 'GET', '/api/products/trail-sync/sync?batchKey=none')));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
