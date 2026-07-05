import { createHash } from 'node:crypto';
import packetSchema from './pcp/schema/packet.v0.2.json';

// PCP — Project Context Protocol (FLX-134 / CLARITY-EN-3).
//
// PCP v0.2 packets are git-tracked briefing files (`pcp/context.json`) owned
// by the repository, not by Fluxion. This module is deterministic-layer code
// in the Fionn style: pure functions, no LLM calls, no I/O. Fluxion never
// reads or writes the file itself — agents read `pcp/context.json` from
// their own clone and pass its *content* here for validation, briefing
// rendering, and re-fingerprinting (the "Git Branch Handoff": the agent
// commits the updated packet to its feature branch for human PR review).
//
// The reference implementation is pcp-server's `pcp/tools/validate.py`;
// fingerprints must stay byte-compatible with it (see computeFingerprint).

export interface PcpPacket {
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

/* eslint-disable @typescript-eslint/no-explicit-any */

// Minimal interpreter for the JSON Schema subset the vendored packet schema
// uses (type, const, required, properties, additionalProperties, items).
// The vendored file stays the single source of truth — swap it to upgrade.
function validateAgainst(schema: any, value: any, path: string, errors: string[]): void {
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: must be ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') errors.push(`${path}: must be a string`);
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: must be an array`);
      return;
    }
    if (schema.items) value.forEach((item, i) => validateAgainst(schema.items, item, `${path}[${i}]`, errors));
    return;
  }
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(`${path}: must be an object`);
      return;
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing required property "${key}"`);
    }
    for (const [key, sub] of Object.entries(value)) {
      const propSchema = schema.properties?.[key];
      if (!propSchema) {
        if (schema.additionalProperties === false) errors.push(`${path}: unknown property "${key}" (additionalProperties is not allowed)`);
        continue;
      }
      validateAgainst(propSchema, sub, `${path}.${key}`, errors);
    }
  }
}

// Parses and schema-validates raw `pcp/context.json` content. Throws with
// every violation listed so an agent can fix the packet in one pass.
export function parsePcpPacket(raw: string): PcpPacket {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`pcp/context.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const errors: string[] = [];
  validateAgainst(packetSchema, data, 'packet', errors);
  if (errors.length > 0) {
    throw new Error(`PCP packet failed schema validation (packet.v0.2.json): ${errors.join('; ')}`);
  }
  return data as PcpPacket;
}

// Python's json.dumps(..., ensure_ascii=True) escapes every character
// outside 0x20–0x7E; JSON.stringify leaves 0x7F+ raw. Escaping the whole
// serialized string is safe because all JSON syntax characters are ASCII.
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

// Byte-compatible with validate.py's compute_fingerprint: fingerprint set to
// "" (key kept), keys sorted recursively, compact separators, ensure_ascii,
// SHA-256 hex. The schema contains no number fields, so Python/JS float
// formatting differences cannot arise.
export function computeFingerprint(packet: PcpPacket): string {
  const canonical = ensureAscii(JSON.stringify(sortKeysDeep({ ...packet, fingerprint: '' })));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function verifyFingerprint(packet: PcpPacket): { valid: boolean; expected: string; found: string } {
  const expected = computeFingerprint(packet);
  const found = packet.fingerprint ?? '';
  return { valid: found === expected, expected, found };
}

// Returns a new packet with a recomputed fingerprint (and updated_at when
// provided) — the finalization half of the Git Branch Handoff.
export function refingerprintPacket(packet: PcpPacket, updatedAt?: string): PcpPacket {
  const next: PcpPacket = { ...packet };
  if (updatedAt) next.updated_at = updatedAt;
  next.fingerprint = computeFingerprint(next);
  return next;
}

// The exact file content to write back, byte-compatible with validate.py's
// json.dump(indent=2) + trailing newline (insertion order preserved).
export function serializePacketFile(packet: PcpPacket): string {
  return ensureAscii(JSON.stringify(packet, null, 2)) + '\n';
}

function bullets(items: string[] | undefined, fallback: string): string {
  if (!items || items.length === 0) return `*(${fallback})*`;
  return items.map((i) => `- ${i}`).join('\n');
}

// Read-only briefing markdown injected into an execution agent's prompt at
// task launch. Ordered from durable intent to immediate objective, mirroring
// the hydrator's Context Package conventions.
export function renderPcpBriefing(packet: PcpPacket): string {
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
