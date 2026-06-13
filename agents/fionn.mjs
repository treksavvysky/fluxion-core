// Fionn agent harness v0 (FLX-126) — autonomous triage through the
// deterministic Cognitive Control Layer.
//
// Fionn-the-agent is a CLIENT of Fionn-the-layer: the layer hydrates context
// and enforces the protocol; the agent (Claude, via the Anthropic SDK)
// supplies the judgment. No LLM call ever happens inside the layer itself.
//
// SCOPE GUARD (Fionn Project Charter, fionn-project-charter): Fionn is
// cognitive control ONLY — it governs, sandboxes, and verifies. It is NOT
// an autonomous software engineer: no mode of this harness may write, edit,
// or execute code, or perform the work an issue describes. Every mode must
// follow the three-phase pipeline: hydrate (deterministic) -> judge (one
// schema-bounded model call) -> enforce & audit (deterministic). Capabilities
// that do engineering work belong to execution agents operating THROUGH the
// layer, never to Fionn.
//
// Usage:
//   node --env-file=.env agents/fionn.mjs triage              # triage all Triage issues
//   node --env-file=.env agents/fionn.mjs triage FLX-124      # triage one issue
//   node --env-file=.env agents/fionn.mjs decompose FLX-102           # PROPOSE a breakdown (no mutation)
//   node --env-file=.env agents/fionn.mjs decompose FLX-102 --apply   # apply via the layer (human gate)
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

// --- Decomposition proposal (FLX-127): human-gated goal-tree synthesis ---
const DECOMPOSE_SCHEMA = {
  type: 'object',
  properties: {
    children: {
      type: 'array',
      description: 'The proposed child issues: between 2 and 7, each independently executable by a single agent',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Concise, action-oriented child title' },
          description: { type: 'string', description: 'What this child delivers' },
          context: { type: 'string', description: 'Agent contract: why this child exists and what an executor must know' },
          acceptanceCriteria: { type: 'string', description: 'Agent contract: verifiable Done conditions as markdown checkboxes ("- [ ] ...")' },
          technicalIntent: { type: 'string', description: 'Agent contract: intended approach or constraints' },
          priority: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
        },
        required: ['title', 'description', 'context', 'acceptanceCriteria', 'technicalIntent', 'priority'],
        additionalProperties: false,
      },
    },
    rationale: {
      type: 'string',
      description: 'Why this decomposition: ordering logic, seams chosen, and how it stays inside the product boundaries',
    },
  },
  required: ['children', 'rationale'],
  additionalProperties: false,
};

const DECOMPOSE_SYSTEM = `You are Fionn, the goal-tree function of an AI-native project tracker. You receive a Context Package for one epic-shaped issue. Propose its decomposition into 2-7 child issues.

Rules:
- Each child must be independently executable by a single agent in one focused effort, with a complete contract (context, checkbox acceptance criteria, technical intent).
- Acceptance criteria must be verifiable conditions written as markdown checkboxes ("- [ ] ..."), because the Verification Gatekeeper will block Done until each is attested with evidence.
- Stay strictly inside the Product Boundaries from the package; if part of the epic crosses a boundary, exclude it and say so in the rationale.
- Order children by dependency: earlier children unblock later ones.
- You are proposing structure, not performing work: never include implementation output in the proposal.`;

async function decomposeIssue(identifier, apply) {
  const pkg = await layer('hydrate_issue_context', { identifier });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: DECOMPOSE_SYSTEM,
    output_config: { format: { type: 'json_schema', schema: DECOMPOSE_SCHEMA } },
    messages: [{ role: 'user', content: pkg }],
  });

  if (response.stop_reason === 'refusal') throw new Error('model refused');
  if (response.stop_reason === 'max_tokens') throw new Error('output truncated — proposal discarded');

  const proposal = JSON.parse(response.content.find(b => b.type === 'text').text);

  if (!Array.isArray(proposal.children) || proposal.children.length < 2 || proposal.children.length > 7) {
    throw new Error(`proposal has ${proposal.children?.length ?? 0} children; required 2-7 — rejected before application`);
  }

  console.log(`\nFionn decomposition proposal for ${identifier} (${MODEL}):`);
  console.log(`\nRationale: ${proposal.rationale}\n`);
  proposal.children.forEach((c, i) => {
    console.log(`  ${i + 1}. [${c.priority}] ${c.title}`);
    console.log(`     ${c.description}`);
    console.log(`     criteria: ${c.acceptanceCriteria.split('\n').filter(l => l.trim().startsWith('- [')).length} checkbox(es)`);
  });

  if (!apply) {
    console.log('\nProposal only — nothing applied. Re-run with --apply to create these issues through the layer.');
    return proposal;
  }

  // Human gate passed (--apply): enforce & audit through the layer
  const result = await layer('decompose_issue', { parentIdentifier: identifier, children: proposal.children });
  const issue = JSON.parse(await layer('read_issue', { identifier }));
  await layer('create_change_log', {
    type: 'Decision',
    description: `Fionn decomposition applied: ${result}. Rationale: ${proposal.rationale}`,
    reason: `Proposal by Fionn agent (model ${MODEL}); applied via --apply human gate`,
    approvedBy: process.env.FIONN_OPERATOR || 'operator (--apply gate)',
    implementedBy: `Fionn/${MODEL}`,
    issueId: issue.id,
    productId: issue.productId ?? undefined,
  });
  console.log(`\nApplied: ${result}`);
  return proposal;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [mode, target] = args.filter(a => a !== '--apply');

  if (mode === 'decompose') {
    if (!target) {
      console.log('Usage: node --env-file=.env agents/fionn.mjs decompose IDENTIFIER [--apply]');
      process.exit(1);
    }
    await decomposeIssue(target.toUpperCase(), apply);
    return;
  }

  if (mode !== 'triage') {
    console.log('Usage: node --env-file=.env agents/fionn.mjs <triage [IDENTIFIER] | decompose IDENTIFIER [--apply]>');
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
