import { createHash } from 'node:crypto';
import handoffSchema from './pcp/schema/packet.v0.2.json';
import projectSchema from './pcp/schema/pcp.schema.json';

// PCP — Project Context Protocol (FLX-134 / CLARITY-EN-3).
//
// Dual PCP v0.2 contract support:
// 1. Git Branch Handoff Envelope (`packet.v0.2.json`, FLX-134):
//    Task-level execution envelope requiring constants name: "Project Context Protocol",
//    packet_type: "project_context", and current_objective with definition_of_done[].
//    Fingerprinted at root fingerprint via ensureAscii stringify with fingerprint: "".
//
// 2. Cognition Ecosystem Project Context Packet (`pcp.schema.json`, v0.2.0):
//    Repository-level truth packet covering currentReality (implemented/notImplemented),
//    decisions, constraints, boundaries, agentBrief, and provenance.
//    Fingerprinted at provenance.fingerprint via deep-sorted serialization omitting provenance.fingerprint.
//
// This module is deterministic-layer code in the Fionn style: pure functions,
// no LLM calls, no I/O. Fluxion never reads or writes repositories itself —
// callers pass raw packet text here for validation, briefing, and re-fingerprinting.

export interface PcpHandoffPacket {
  protocol: 'pcp';
  name: string;
  version: string;
  packet_type: 'project_context';
  project: { name: string; purpose: string };
  current_objective: { title: string; definition_of_done: string[] };
  constraints?: string[];
  context_notes?: string[];
  evaluation?: { status: string; reason: string };
  architecture_decision?: { decision: string; rationale: string; possible_future_forms?: string[] };
  definition_of_done?: string[];
  builds_toward?: string[];
  fingerprint?: string;
  updated_at?: string;
}

export interface CognitionProjectPacket {
  protocol: 'pcp';
  version: string;
  project: {
    name: string;
    codename?: string;
    purpose: string;
    status: 'concept' | 'active' | 'paused' | 'archived';
    repo?: string;
  };
  currentReality: {
    summary: string;
    implemented?: string[];
    notImplemented?: string[];
    knownIssues?: string[];
  };
  decisions?: Array<{
    id: string;
    summary: string;
    rationale?: string;
    date?: string;
    status: 'active' | 'superseded' | 'uncertain';
  }>;
  constraints?: Array<{
    id: string;
    summary: string;
    kind: 'technical' | 'strategic' | 'operational' | 'design';
  }>;
  activeIntent?: {
    title: string;
    description: string;
    desiredOutcome: string;
  };
  nextActions?: Array<{
    id: string;
    summary: string;
    priority: 'low' | 'medium' | 'high';
  }>;
  boundaries?: {
    inScope: string[];
    outOfScope: string[];
  };
  agentBrief?: {
    instructions: string;
    risks?: string[];
    verificationCommands?: string[];
  };
  provenance: {
    createdAt: string;
    updatedAt: string;
    sources?: string[];
    fingerprint?: string;
    changelog?: Array<{
      date: string;
      summary: string;
    }>;
  };
}

export type PcpPacket = PcpHandoffPacket | CognitionProjectPacket;

/* eslint-disable @typescript-eslint/no-explicit-any */

// Minimal interpreter for the JSON Schema subset used by the vendored schemas
// (type, const, enum, minLength, pattern, required, properties, additionalProperties, items).
function validateAgainst(schema: any, value: any, path: string, errors: string[]): void {
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: must be ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of [${schema.enum.map((e: any) => JSON.stringify(e)).join(', ')}], got ${JSON.stringify(value)}`);
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${path}: must be a string`);
      return;
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: must have minimum length ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: does not match pattern ${schema.pattern}`);
    }
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: must be an array`);
      return;
    }
    if (schema.items) {
      value.forEach((item, i) => validateAgainst(schema.items, item, `${path}[${i}]`, errors));
    }
    return;
  }
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(`${path}: must be an object`);
      return;
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) {
        errors.push(`${path}: missing required property "${key}"`);
      }
    }
    for (const [key, sub] of Object.entries(value)) {
      const propSchema = schema.properties?.[key];
      if (!propSchema) {
        if (schema.additionalProperties === false) {
          errors.push(`${path}: unknown property "${key}" (additionalProperties is not allowed)`);
        }
        continue;
      }
      validateAgainst(propSchema, sub, `${path}.${key}`, errors);
    }
  }
}

export function isProjectPacket(packet: unknown): packet is CognitionProjectPacket {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return false;
  const p = packet as Record<string, unknown>;
  return 'currentReality' in p && 'provenance' in p;
}

export function isHandoffPacket(packet: unknown): packet is PcpHandoffPacket {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return false;
  const p = packet as Record<string, unknown>;
  return p.packet_type === 'project_context' || ('name' in p && p.name === 'Project Context Protocol') || ('current_objective' in p && !('currentReality' in p));
}

// Parses and schema-validates raw `pcp/context.json` content for either contract.
export function parsePcpPacket(raw: string): PcpPacket {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`pcp/context.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('pcp/context.json must contain a valid JSON object');
  }

  const errors: string[] = [];
  if (isProjectPacket(data)) {
    validateAgainst(projectSchema, data, 'packet', errors);
    if (errors.length > 0) {
      throw new Error(`PCP project context packet failed schema validation (pcp.schema.json): ${errors.join('; ')}`);
    }
    return data as CognitionProjectPacket;
  }

  validateAgainst(handoffSchema, data, 'packet', errors);
  if (errors.length > 0) {
    throw new Error(`PCP packet failed schema validation (packet.v0.2.json): ${errors.join('; ')}`);
  }
  return data as PcpHandoffPacket;
}

// Python's json.dumps(..., ensure_ascii=True) escapes every character outside 0x20–0x7E
function ensureAscii(json: string): string {
  return json.replace(/[\u007f-\uffff]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

function sortKeysDeep(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

// Cognition stableStringify: key-sorted, omitting undefined, compact separators
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

// Computes the fingerprint according to the packet's contract
export function computeFingerprint(packet: PcpPacket): string {
  if (isProjectPacket(packet)) {
    const { provenance, ...rest } = packet;
    const { fingerprint: _omitted, ...provenanceRest } = provenance ?? {};
    return createHash('sha256')
      .update(stableStringify({ ...rest, provenance: provenanceRest }))
      .digest('hex');
  }

  // Handoff envelope algorithm: ensureAscii, sortKeysDeep, fingerprint = ""
  const canonical = ensureAscii(JSON.stringify(sortKeysDeep({ ...packet, fingerprint: '' })));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function verifyFingerprint(packet: PcpPacket): { valid: boolean; expected: string; found: string } {
  const expected = computeFingerprint(packet);
  const found = isProjectPacket(packet)
    ? (packet.provenance?.fingerprint ?? '')
    : (packet.fingerprint ?? '');
  return { valid: found === expected && found.length > 0, expected, found };
}

// Returns a new packet with a recomputed fingerprint (and updated_at / updatedAt stamped)
export function refingerprintPacket(packet: PcpPacket, updatedAt?: string): PcpPacket {
  if (isProjectPacket(packet)) {
    const ts = updatedAt || (packet.provenance?.updatedAt ? new Date().toISOString() : new Date().toISOString());
    const next: CognitionProjectPacket = {
      ...packet,
      provenance: {
        ...packet.provenance,
        updatedAt: updatedAt ?? ts,
      },
    };
    next.provenance.fingerprint = computeFingerprint(next);
    return next;
  }

  const next: PcpHandoffPacket = { ...packet };
  if (updatedAt) next.updated_at = updatedAt;
  next.fingerprint = computeFingerprint(next);
  return next;
}

// Serialization matching each contract's native conventions
export function serializePacketFile(packet: PcpPacket): string {
  if (isProjectPacket(packet)) {
    return JSON.stringify(packet, null, 2) + '\n';
  }
  return ensureAscii(JSON.stringify(packet, null, 2)) + '\n';
}

function bullets(items: string[] | undefined, fallback: string = 'none'): string {
  if (!items || items.length === 0) return `*(${fallback})*`;
  return items.map((i) => `- ${i}`).join('\n');
}

// Read-only briefing markdown renderer for Project Context Packets
function renderCognitionBriefing(packet: CognitionProjectPacket): string {
  const sections: string[] = [];
  sections.push(`# PCP Briefing — ${packet.project.name} (Project Context Packet v${packet.version})`);
  sections.push(
    'Read-only project context briefing parsed from repository `pcp/context.json` (fingerprint verified). ' +
    'Do not edit the packet during execution; state is updated only in the finalization stage via `refingerprint_pcp_packet`.'
  );

  const projMeta = [
    `status: ${packet.project.status}`,
    packet.project.codename ? `codename: ${packet.project.codename}` : '',
    packet.project.repo ? `repo: ${packet.project.repo}` : '',
  ].filter(Boolean).join(' · ');
  sections.push(`## Project\n**${packet.project.name}** _(${projMeta})_\n${packet.project.purpose}`);

  // Current reality with explicit warnings
  const realitySections: string[] = [`## Current Reality\n${packet.currentReality.summary}`];
  if (packet.currentReality.implemented?.length) {
    realitySections.push(`### Implemented Capabilities\n${bullets(packet.currentReality.implemented)}`);
  }
  if (packet.currentReality.notImplemented?.length) {
    realitySections.push(`### Not Implemented (Warning: Do NOT assume these capabilities have shipped)\n${bullets(packet.currentReality.notImplemented)}`);
  }
  if (packet.currentReality.knownIssues?.length) {
    realitySections.push(`### Known Issues\n${bullets(packet.currentReality.knownIssues)}`);
  }
  sections.push(realitySections.join('\n\n'));

  // Decisions preserving status, rationale, and uncertainty
  if (packet.decisions?.length) {
    const decRows = packet.decisions.map((d) => {
      const statusNotice = d.status === 'uncertain'
        ? '**UNCERTAIN / UNRATIFIED**'
        : `status: ${d.status}`;
      const dateStr = d.date ? `, date: ${d.date}` : '';
      const meta = `_(${statusNotice}${dateStr})_`;
      const rat = d.rationale ? `\n  Rationale: ${d.rationale}` : '';
      return `- **${d.summary}** ${meta}${rat}`;
    });
    sections.push(`## Decisions\n${decRows.join('\n')}`);
  }

  // Constraints
  if (packet.constraints?.length) {
    sections.push(`## Constraints (Scope Guard)\n${packet.constraints.map((c) => `- _(${c.kind})_ ${c.summary}`).join('\n')}`);
  }

  // Active Intent
  if (packet.activeIntent) {
    sections.push(`## Active Intent\n**${packet.activeIntent.title}**\n${packet.activeIntent.description}\n_Desired outcome:_ ${packet.activeIntent.desiredOutcome}`);
  }

  // Next Actions
  if (packet.nextActions?.length) {
    sections.push(`## Next Actions\n${packet.nextActions.map((a) => `- [priority: ${a.priority}] ${a.summary}`).join('\n')}`);
  }

  // Boundaries
  if (packet.boundaries) {
    sections.push(
      `## Boundaries\n` +
      `**In scope:**\n${bullets(packet.boundaries.inScope)}\n\n` +
      `**Out of scope (Authorization Guard: do not implement or alter):**\n${bullets(packet.boundaries.outOfScope)}`
    );
  }

  // Agent Brief
  if (packet.agentBrief) {
    const briefParts = [`## Agent Brief\n${packet.agentBrief.instructions}`];
    if (packet.agentBrief.risks?.length) {
      briefParts.push(`**Risks:**\n${bullets(packet.agentBrief.risks)}`);
    }
    if (packet.agentBrief.verificationCommands?.length) {
      briefParts.push(`**Verification commands:**\n${packet.agentBrief.verificationCommands.map((c) => `- \`${c}\``).join('\n')}`);
    }
    sections.push(briefParts.join('\n\n'));
  }

  // Provenance
  const provParts = [
    `Packet fingerprint: \`${packet.provenance.fingerprint}\``,
    `created ${packet.provenance.createdAt}`,
    `updated ${packet.provenance.updatedAt}`,
  ];
  if (packet.provenance.sources?.length) {
    provParts.push(`sources: ${packet.provenance.sources.join(', ')}`);
  }
  let provFooter = `---\n_${provParts.join(' · ')}_`;
  if (packet.provenance.changelog?.length) {
    provFooter += `\n\n### Changelog\n${packet.provenance.changelog.map((c) => `- ${c.date}: ${c.summary}`).join('\n')}`;
  }
  sections.push(provFooter);

  return sections.join('\n\n');
}

// Read-only briefing markdown renderer for Git Branch Handoff Envelopes
function renderHandoffBriefing(packet: PcpHandoffPacket): string {
  const sections: string[] = [];
  sections.push(`# PCP Briefing — ${packet.project.name} (packet v${packet.version})`);
  sections.push(
    'Read-only briefing parsed from the repository\'s `pcp/context.json` (fingerprint verified). ' +
    'Do not edit the packet during execution; packet state is updated only in the finalization stage via `refingerprint_pcp_packet`.'
  );
  sections.push(`## Project\n**${packet.project.name}** — ${packet.project.purpose}`);
  sections.push(`## Current Objective — ${packet.current_objective.title}\nDefinition of done:\n${bullets(packet.current_objective.definition_of_done, 'not documented')}`);
  sections.push(`## Constraints (scope guard)\n${bullets(packet.constraints, 'none declared')}`);
  if (packet.context_notes?.length) sections.push(`## Context Notes\n${bullets(packet.context_notes, 'none')}`);
  if (packet.evaluation) sections.push(`## Evaluation\nStatus: ${packet.evaluation.status} — ${packet.evaluation.reason}`);
  if (packet.architecture_decision) {
    const forms = packet.architecture_decision.possible_future_forms?.length
      ? `\nPossible future forms:\n${bullets(packet.architecture_decision.possible_future_forms, 'none')}`
      : '';
    sections.push(`## Architecture Decision\n${packet.architecture_decision.decision}\nRationale: ${packet.architecture_decision.rationale}${forms}`);
  }
  if (packet.definition_of_done?.length) sections.push(`## Packet Definition of Done\n${bullets(packet.definition_of_done, 'none')}`);
  if (packet.builds_toward?.length) sections.push(`## Builds Toward\n${bullets(packet.builds_toward, 'none')}`);
  sections.push(`---\nPacket fingerprint: \`${packet.fingerprint}\`${packet.updated_at ? ` · updated ${packet.updated_at}` : ''}`);
  return sections.join('\n\n');
}

export function renderPcpBriefing(packet: PcpPacket): string {
  if (isProjectPacket(packet)) {
    return renderCognitionBriefing(packet);
  }
  return renderHandoffBriefing(packet as PcpHandoffPacket);
}
