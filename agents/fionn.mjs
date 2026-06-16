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
//   node --env-file=.env agents/fionn.mjs verify AETHERMUX-3          # judge attestation evidence (advisory, no mutation)
//
// Config (env):
//   ANTHROPIC_API_KEY  required
//   FIONN_MODEL        default claude-sonnet-4-6 (production judgment, bumped from
//                      haiku after a head-to-head — better-calibrated verdicts);
//                      claude-haiku-4-5-20251001 for cheap testing, claude-opus-4-8 for hardest judgments
//   FLUXION_URL        default http://localhost:3002
//   FLUXION_API_KEY    required (Fluxion MCP auth)

import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';

const MODEL = process.env.FIONN_MODEL || 'claude-sonnet-4-6';
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

// Gate integrity (FLX-128): the human gate is only meaningful if the
// reviewed artifact is the applied artifact. The propose run persists the
// proposal to .fionn/proposals/<IDENT>.json with a hash of the epic's
// contract; --apply applies that file verbatim (no model call) and refuses
// if the proposal is missing or the contract changed since review.
const PROPOSAL_DIR = '.fionn/proposals';

function contractHash(issue) {
  return createHash('sha256')
    .update([issue.title, issue.description, issue.context, issue.acceptanceCriteria, issue.technicalIntent].map(v => v ?? '').join(' '))
    .digest('hex').slice(0, 32);
}

function printProposal(identifier, proposal) {
  console.log(`\nFionn decomposition proposal for ${identifier} (${proposal.model ?? MODEL}):`);
  console.log(`\nRationale: ${proposal.rationale}\n`);
  proposal.children.forEach((c, i) => {
    console.log(`  ${i + 1}. [${c.priority}] ${c.title}`);
    console.log(`     ${c.description}`);
    console.log(`     criteria: ${c.acceptanceCriteria.split('\n').filter(l => l.trim().startsWith('- [')).length} checkbox(es)`);
  });
}

async function decomposeIssue(identifier, apply) {
  const issue = JSON.parse(await layer('read_issue', { identifier }));
  const proposalPath = `${PROPOSAL_DIR}/${identifier}.json`;

  if (apply) {
    // Apply the PERSISTED proposal verbatim — never a fresh model call.
    if (!existsSync(proposalPath)) {
      throw new Error(`no persisted proposal for ${identifier}. Run "decompose ${identifier}" first, review the output, then re-run with --apply.`);
    }
    const saved = JSON.parse(readFileSync(proposalPath, 'utf8'));
    if (saved.contractHash !== contractHash(issue)) {
      throw new Error(`stale proposal: ${identifier}'s contract changed since the proposal was reviewed. Re-run "decompose ${identifier}" to propose against the current contract.`);
    }
    const proposal = saved.proposal;
    printProposal(identifier, { ...proposal, model: saved.model });

    const result = await layer('decompose_issue', { parentIdentifier: identifier, children: proposal.children });
    await layer('create_change_log', {
      type: 'Decision',
      description: `Fionn decomposition applied: ${result}. Rationale: ${proposal.rationale}`,
      reason: `Proposal by Fionn agent (model ${saved.model}); reviewed and applied verbatim via --apply human gate`,
      approvedBy: process.env.FIONN_OPERATOR || 'operator (--apply gate)',
      implementedBy: `Fionn/${saved.model}`,
      issueId: issue.id,
      productId: issue.productId ?? undefined,
    });
    unlinkSync(proposalPath);
    console.log(`\nApplied: ${result}`);
    return proposal;
  }

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

  mkdirSync(PROPOSAL_DIR, { recursive: true });
  writeFileSync(proposalPath, JSON.stringify({
    identifier,
    model: MODEL,
    contractHash: contractHash(issue),
    proposal,
  }, null, 2));

  printProposal(identifier, proposal);
  console.log(`\nProposal only — nothing applied. Persisted to ${proposalPath}; re-run with --apply to create exactly these issues through the layer.`);
  return proposal;
}


// --- Verification (FLX-130): independent judgment on attestation evidence ---
// Judgment-only: Fionn judges whether the cited evidence substantiates each
// attested criterion. It mutates no issue state and posts nothing external;
// it records an advisory Verification change log. Per the Charter, Fionn does
// NOT execute or re-run anything — it judges the evidence as presented, the
// way a reviewer reads a PR description rather than re-running its CI.
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'The criterion index being judged' },
          verdict: {
            type: 'string',
            enum: ['supported', 'insufficient', 'contradicted', 'unverifiable'],
            description: 'supported: evidence concretely substantiates the claim; insufficient: too vague/generic/circular to confirm; contradicted: evidence undercuts the claim or is internally inconsistent; unverifiable: no concrete artifact cited and the claim cannot be confirmed from evidence alone',
          },
          rationale: { type: 'string', description: 'One to three sentences judging the evidence' },
        },
        required: ['index', 'verdict', 'rationale'],
        additionalProperties: false,
      },
    },
    overallVerdict: {
      type: 'string',
      enum: ['pass', 'concerns', 'fail'],
      description: 'Based on the per-criterion EVIDENCE verdicts only (independent of policy/coverage): pass: every criterion supported; concerns: some insufficient/unverifiable but none contradicted; fail: any criterion contradicted',
    },
    summary: { type: 'string', description: 'One or two sentences on the overall judgment' },
    policyConflicts: {
      type: 'array',
      description: 'Criteria that an active Decision supersedes or contradicts. Empty if none. (FLX-131)',
      items: {
        type: 'object',
        properties: {
          criterionIndex: { type: 'number', description: 'The affected criterion index' },
          decision: { type: 'string', description: 'Short reference to the superseding/contradicting Decision' },
          detail: { type: 'string', description: 'How the Decision conflicts with the criterion' },
        },
        required: ['criterionIndex', 'decision', 'detail'],
        additionalProperties: false,
      },
    },
    coverageGaps: {
      type: 'array',
      description: 'Boundary/architecture requirements from the briefs that the criteria as a whole fail to cover. Empty if none. (FLX-131)',
      items: {
        type: 'object',
        properties: {
          requirement: { type: 'string', description: 'The brief requirement not covered by any criterion' },
          fromBrief: { type: 'string', description: 'Boundaries or Architecture' },
          detail: { type: 'string', description: 'Why the criteria fail to cover it' },
        },
        required: ['requirement', 'fromBrief', 'detail'],
        additionalProperties: false,
      },
    },
  },
  required: ['criteria', 'overallVerdict', 'summary', 'policyConflicts', 'coverageGaps'],
  additionalProperties: false,
};

const VERIFY_SYSTEM = `You are Fionn, the verification function of an AI-native project tracker. You receive an issue's contract and the evidence an executor attested for each acceptance criterion. Judge whether the cited EVIDENCE actually substantiates each criterion.

Hard constraints:
- You judge the evidence as presented. You do NOT re-run commands, tests, or builds — execution belongs to the execution plane, not to you. Treat this like a reviewer reading a pull request's description, not re-running its CI.
- Per criterion verdict:
  - "supported": specific, checkable evidence substantiates the claim (names the test, the command, the observed result, a commit hash, an API response, etc.).
  - "insufficient": evidence is vague, generic, or circular ("works as expected", "implemented and tested" with no specifics).
  - "contradicted": evidence undercuts the claim or is internally inconsistent.
  - "unverifiable": the claim cannot be confirmed from the evidence alone and no concrete artifact is cited (e.g. "survives restart" with no restart actually exercised).
- Be skeptical but fair: reward specific, checkable evidence. You can catch weak, vague, or contradictory evidence; you CANNOT catch plausible fabrication — if a verdict hinges on trusting an unverifiable claim, say so.
- overallVerdict: "pass" only if every criterion is supported; "concerns" if some are insufficient/unverifiable but none contradicted; "fail" if any is contradicted. The overallVerdict reflects EVIDENCE ONLY — it is independent of the policy/coverage checks below.

You are also given GOVERNING CONTEXT: the product's active Decisions and its Boundaries/Architecture briefs. Beyond the evidence verdicts, perform two separate, advisory checks (a criterion can have perfectly good evidence yet still be flagged here):
- policyConflicts: flag a criterion ONLY when an active Decision genuinely SUPERSEDES or CONTRADICTS it (e.g. a criterion requiring something a later Decision reversed). If a criterion is merely CONSISTENT with a Decision, do NOT list it — silence means consistent. Never add "noted for completeness" or "no conflict" entries.
- coverageGaps: flag a requirement from the Boundaries/Architecture briefs ONLY when it falls within THIS issue's own scope and phase AND no acceptance criterion enforces it. Do NOT flag requirements that belong to a later phase or to a different issue's responsibility (e.g. a Phase 2 mechanism is not a gap in a Phase 1 issue).
Return empty arrays when there are genuinely no conflicts or gaps. Do not invent conflicts or gaps to seem thorough — over-flagging erodes trust in the signal.`;

const VERDICT_MARK = { supported: '✓', insufficient: '~', contradicted: '✗', unverifiable: '?' };

async function verifyIssue(identifier) {
  const issue = JSON.parse(await layer('read_issue', { identifier }));
  const attested = (issue.checklist || []).filter(c => c.attested);
  if (attested.length === 0) {
    console.log(`${identifier}: no attested checkbox criteria to verify.`);
    return null;
  }

  // Governing context (FLX-131): active Decisions + Boundaries/Architecture briefs.
  let gov = { decisions: [], briefs: [] };
  try {
    gov = JSON.parse(await layer('read_governing_context', { identifier }));
  } catch (e) {
    console.log(`  (governing context unavailable: ${e.message} — judging evidence only)`);
  }
  const decisionsBlock = gov.decisions?.length
    ? gov.decisions.map(d => `- [${d.type}] ${d.description}${d.reason ? `\n  reason: ${d.reason}` : ''}`).join('\n')
    : '(no active Decisions on record)';
  const briefsBlock = gov.briefs?.length
    ? gov.briefs.map(b => `### ${b.docType} brief: ${b.title}\n${b.content}`).join('\n\n')
    : '(no Boundaries/Architecture briefs on record)';

  const evidenceBlock = attested.map(c =>
    `### Criterion [${c.index}]: ${c.text}\nAttestor: ${c.attestor ?? 'unknown'}\nEvidence: ${c.evidence || '(none provided)'}`
  ).join('\n\n');
  const userMsg = [
    `# Issue ${issue.identifier} — ${issue.title}`,
    '',
    '## Contract',
    `Description: ${issue.description || '(none)'}`,
    `Context: ${issue.context || '(none)'}`,
    `Technical intent: ${issue.technicalIntent || '(none)'}`,
    '',
    '## Governing context — active Decisions',
    decisionsBlock,
    '',
    '## Governing context — product briefs',
    briefsBlock,
    '',
    '## Attested criteria and evidence to judge',
    evidenceBlock,
  ].join('\n');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: VERIFY_SYSTEM,
    output_config: { format: { type: 'json_schema', schema: VERIFY_SCHEMA } },
    messages: [{ role: 'user', content: userMsg }],
  });

  if (response.stop_reason === 'refusal') throw new Error('model refused');
  if (response.stop_reason === 'max_tokens') throw new Error('verdict truncated — discarded');

  const verdict = JSON.parse(response.content.find(b => b.type === 'text').text);

  console.log(`\nFionn verification of ${identifier} (${MODEL}) — overall: ${verdict.overallVerdict.toUpperCase()}`);
  console.log(`${verdict.summary}\n`);
  for (const c of verdict.criteria.sort((a, b) => a.index - b.index)) {
    const crit = attested.find(a => a.index === c.index);
    console.log(`  [${VERDICT_MARK[c.verdict] ?? '?'}] ${c.verdict} — criterion ${c.index}: ${crit?.text ?? ''}`);
    console.log(`      ${c.rationale}`);
  }

  const policyConflicts = verdict.policyConflicts ?? [];
  const coverageGaps = verdict.coverageGaps ?? [];
  if (policyConflicts.length) {
    console.log(`\n  POLICY CONFLICTS (criteria vs active Decisions):`);
    for (const pc of policyConflicts) console.log(`  ⚠ criterion ${pc.criterionIndex}: ${pc.detail} [${pc.decision}]`);
  }
  if (coverageGaps.length) {
    console.log(`\n  COVERAGE GAPS (briefs not covered by criteria):`);
    for (const cg of coverageGaps) console.log(`  ⚠ ${cg.requirement} (${cg.fromBrief}): ${cg.detail}`);
  }
  if (!policyConflicts.length && !coverageGaps.length) {
    console.log(`\n  No policy conflicts or boundary coverage gaps found.`);
  }

  // Audit (judgment-only): record the verdict, mutate nothing.
  const counts = verdict.criteria.reduce((a, c) => { a[c.verdict] = (a[c.verdict] ?? 0) + 1; return a; }, {});
  const tally = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
  const govTally = `${policyConflicts.length} policy conflict(s), ${coverageGaps.length} coverage gap(s)`;
  await layer('create_change_log', {
    type: 'Verification',
    description: `Fionn verification of ${identifier}: ${verdict.overallVerdict.toUpperCase()} — ${verdict.summary} [${tally}; ${govTally}]`,
    reason: `Advisory judgment-only verification by Fionn (model ${MODEL}); evidence judged as presented, plus policy/boundary checks against governing context (FLX-131); no execution, issue state unchanged.`,
    approvedBy: 'Fionn (advisory verification)',
    implementedBy: `Fionn/${MODEL}`,
    issueId: issue.id,
    productId: issue.productId ?? undefined,
  });
  console.log(`\nVerdict recorded to Change Control (advisory; ${identifier} state unchanged).`);
  return verdict;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [mode, target] = args.filter(a => a !== '--apply');

  if (mode === 'verify') {
    if (!target) {
      console.log('Usage: node --env-file=.env agents/fionn.mjs verify IDENTIFIER');
      process.exit(1);
    }
    await verifyIssue(target.toUpperCase());
    return;
  }

  if (mode === 'decompose') {
    if (!target) {
      console.log('Usage: node --env-file=.env agents/fionn.mjs decompose IDENTIFIER [--apply]');
      process.exit(1);
    }
    await decomposeIssue(target.toUpperCase(), apply);
    return;
  }

  if (mode !== 'triage') {
    console.log('Usage: node --env-file=.env agents/fionn.mjs <triage [IDENTIFIER] | decompose IDENTIFIER [--apply] | verify IDENTIFIER>');
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
