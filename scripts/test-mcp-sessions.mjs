// FLX-113: verifies concurrent SSE sessions using the official MCP SDK client.
// Usage: node --env-file=.env scripts/test-mcp-sessions.mjs [baseUrl]
// The pre-FLX-113 failure mode: connecting client B tore down client A's
// transport, so A's next call died with "No active SSE connection".

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { EventSource } from 'eventsource';

globalThis.EventSource = globalThis.EventSource ?? EventSource;

const BASE_URL = process.argv[2] || 'http://localhost:3002';
const API_KEY = process.env.FLUXION_API_KEY;
if (!API_KEY) {
  console.error('FLUXION_API_KEY must be set');
  process.exit(1);
}

let failures = 0;
function check(label, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`  [${mark}] ${label}${condition || !detail ? '' : ` — ${detail}`}`);
}

// Wait for the server to accept connections (a restarting container refuses
// for ~1-2s, which makes the SDK's SSE start() throw rather than retry).
async function waitForReady() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/products`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Server never became ready');
}

async function connect(name) {
  for (let attempt = 1; ; attempt++) {
    const client = new Client({ name, version: '1.0.0' });
    const transport = new SSEClientTransport(new URL(`${BASE_URL}/api/mcp?api-key=${API_KEY}`));
    try {
      await client.connect(transport);
      return client;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.log(`    (connect attempt ${attempt} failed: ${err.message}; retrying)`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

await waitForReady();

async function toolWorks(client, tool) {
  try {
    const result = await client.callTool({ name: tool, arguments: {} });
    return Array.isArray(result.content) && result.content.length > 0;
  } catch (err) {
    console.log(`    (call failed: ${err.message})`);
    return false;
  }
}

console.log('1. Single session baseline');
const a = await connect('session-a');
const tools = await a.listTools();
check('client A lists 25 tools', tools.tools.length === 25, `got ${tools.tools.length}`);
check('client A can call read_products', await toolWorks(a, 'read_products'));

console.log('\n2. Concurrent second session');
const b = await connect('session-b');
check('client B connects while A is open', true);
check('client B can call read_cycles', await toolWorks(b, 'read_cycles'));
check('client A STILL works after B connected (pre-FLX-113 failure)', await toolWorks(a, 'read_roadmaps'));

console.log('\n3. Independent teardown');
await a.close();
await new Promise((r) => setTimeout(r, 500));
check('client B still works after A disconnects', await toolWorks(b, 'read_products'));

console.log('\n4. Third session joins after churn');
const c = await connect('session-c');
check('client C connects and works', await toolWorks(c, 'read_cycles'));
check('client B unaffected by C', await toolWorks(b, 'read_roadmaps'));

console.log('\n5. Session cleanup + stale-session routing');
// A stale/unknown sessionId simulates a client whose EventSource silently
// reconnected. With exactly one live session the server heals to it (202);
// with several it must strictly reject (400) rather than guess. External
// clients (e.g. a live Claude Code session) may legitimately exist on a
// shared instance, so assertions compare against a measured baseline.
await c.close();
await new Promise((r) => setTimeout(r, 1000));
const stalePost = async () => {
  const res = await fetch(`${BASE_URL}/api/mcp/messages?token=${API_KEY}&sessionId=00000000-dead-beef-0000-000000000000`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  return { status: res.status, body: await res.text() };
};
const baseline = await stalePost();
check(
  'stale sessionId is routed, never orphaned (202 healed or 400 strict)',
  baseline.status === 202 || (baseline.status === 400 && baseline.body.includes('multiple')),
  JSON.stringify(baseline)
);
console.log(`    (baseline: ${baseline.status === 202 ? 'healed to sole live session' : 'strict ambiguity — external sessions are live'})`);

const d = await connect('session-d');
const withD = await stalePost();
check('with extra sessions live, stale sessionId is strictly rejected', withD.status === 400 && withD.body.includes('multiple'), JSON.stringify(withD));

await d.close();
await new Promise((r) => setTimeout(r, 1500));
const afterD = await stalePost();
check('closing a session deregisters its transport (returns to baseline)', afterD.status === baseline.status, `baseline ${baseline.status}, after ${afterD.status}`);
check('client B unaffected throughout', await toolWorks(b, 'read_products'));

await b.close();

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
