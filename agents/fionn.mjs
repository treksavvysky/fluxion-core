// Fionn agent harness v0 (FLX-126) — autonomous triage through the
// deterministic Cognitive Command Layer.
//
// Fionn-the-agent is a CLIENT of Fionn-the-layer: the layer hydrates context
// and enforces the protocol; the agent (Claude, via the Anthropic SDK)
// supplies the judgment. No LLM call ever happens inside the layer itself.
//
// Usage:
//   node --env-file=.env agents/fionn.mjs triage              # triage all Triage issues
//   node --env-file=.env agents/fionn.mjs triage FLX-124      # triage one issue
//
// Config (env):
//   ANTHROPIC_API_KEY  required
//   FIONN_MODEL        default claude-haiku-4-5-20251001 (testing);
//                      production: claude-sonnet-4-6, or claude-opus-4-8 for advanced tasks
//   FLUXION_URL        default http://localhost:3002
//   FLUXION_API_KEY    required (Fluxion MCP auth)

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.FIONN_MODEL || 'claude-haiku-4-5-20251001';
const BASE_URL = process.env.FLUXION_URL || 'http://localhost:3002';
const FLUXION_KEY = process.env.FLUXION_API_KEY;
if (!FLUXION_KEY) throw new Error('FLUXION_API_KEY must be set');
if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY must be set');

const anthropic = new Anthropic();

// --- Fluxion layer access (stateless JSON-RPC) ---
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

// --- The triage decision schema (structured output) ---
const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    nextStatus: {
      type: 'string',
      enum: ['Backlog', 'Todo', 'Cancelled'],
      description: 'Where this Triage issue belongs: Todo (actionable now), Backlog (real but not now), Cancelled (noise, duplicate, or out of scope)',
    },
    priority: {
      type: 'string',
      enum: ['Low', 'Medium', 'High', 'Critical'],
      description: 'Corrected priority based on the product context',
    },
    rationale: {
      type: 'string',
      description: 'One to three sentences: why this disposition, grounded in the product vision/boundaries from the context package',
    },
  },
  required: ['nextStatus', 'priority', 'rationale'],
  additionalProperties: false,
};

const SYSTEM = `You are Fionn, the triage function of an AI-native project tracker. You receive a Context Package for one issue currently in Triage (an unvetted signal). Decide its disposition.

Ground every decision in the Product Vision and especially the Product Boundaries sections of the package — work that crosses a boundary is Cancelled with the boundary named in the rationale. Recurring failures referencing a prior fixed issue deserve elevated priority (possible regression). Be decisive; Triage is a gate, not a parking lot.`;

async function triageIssue(identifier) {
  const pkg = await layer('hydrate_issue_context', { identifier });
  const issue = JSON.parse(await layer('read_issue', { identifier }));

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: DECISION_SCHEMA } },
    messages: [{ role: 'user', content: pkg }],
  });

  if (response.stop_reason === 'refusal') {
    console.log(`  ${identifier}: model refused — leaving in Triage`);
    return null;
  }
  if (response.stop_reason === 'max_tokens') {
    console.log(`  ${identifier}: output truncated — leaving in Triage`);
    return null;
  }

  const decision = JSON.parse(response.content.find(b => b.type === 'text').text);

  // Belt and braces: the hydrator told the agent the legal moves; verify
  // anyway before applying. The layer's state machine would also reject.
  if (!issue.allowedNextStatuses.includes(decision.nextStatus)) {
    console.log(`  ${identifier}: decision ${decision.nextStatus} not in legal transitions [${issue.allowedNextStatuses.join(', ')}] — skipping`);
    return null;
  }

  await layer('update_issue', { identifier, status: decision.nextStatus, priority: decision.priority });
  await layer('create_change_log', {
    type: 'Decision',
    description: `Fionn triage: ${identifier} -> ${decision.nextStatus} (${decision.priority}). ${decision.rationale}`,
    reason: `Autonomous triage by Fionn agent (model ${MODEL})`,
    approvedBy: 'Fionn (autonomous triage)',
    implementedBy: `Fionn/${MODEL}`,
    issueId: issue.id,
    productId: issue.productId ?? undefined,
  });

  console.log(`  ${identifier}: -> ${decision.nextStatus} (${decision.priority}) — ${decision.rationale}`);
  return decision;
}

async function main() {
  const [mode, target] = process.argv.slice(2);
  if (mode !== 'triage') {
    console.log('Usage: node --env-file=.env agents/fionn.mjs triage [IDENTIFIER]');
    process.exit(1);
  }

  let identifiers;
  if (target) {
    identifiers = [target.toUpperCase()];
  } else {
    const issues = JSON.parse(await layer('read_issues', { status: 'Triage' }));
    identifiers = issues.map(i => i.identifier);
  }

  if (identifiers.length === 0) {
    console.log('Nothing in Triage.');
    return;
  }

  console.log(`Fionn triage (${MODEL}) — ${identifiers.length} issue(s):`);
  for (const id of identifiers) {
    try {
      await triageIssue(id);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        console.log(`  ${id}: rate limited — stopping run`);
        break;
      }
      if (err instanceof Anthropic.APIError) {
        console.log(`  ${id}: API error ${err.status}: ${err.message}`);
        continue;
      }
      console.log(`  ${id}: ${err.message}`);
    }
  }
}

await main();
