// Per-key capability tiers and the personal-domain flag (FLX-149).
//
// George's access model for Fluxion (2026-11-13):
//   read  — read products, issues, roadmaps, cycles, Fionn context, governing doctrine
//   write — + create issues and proposals; update descriptions, criteria and status (not closing)
//   close — + close or cancel issues (Done / Cancelled)
//   full  — everything, including governance writes (Vision/Boundaries/Architecture documents,
//           Decision and Config Change logs, product/project/cycle/repository lifecycle).
//           Today's behaviour, and the default for every key not listed in the policy.
//
// The personal-domain flag (LIFE Boundaries brief, approved 2026-11-13) is separate from the
// tier: it decides whether a key may see or touch the LIFE product at all. It is granted to
// operator-delegated identities (Fionn, the AI Gateway) and withheld from execution agents.
// A key with the flag still acts on LIFE only within its tier.
//
// Policy: FLUXION_AGENT_ACCESS, a JSON object mapping an identity from FLUXION_AGENT_KEYS to
// {"tier": "read"|"write"|"close"|"full", "personal": true|false}, e.g.
//   FLUXION_AGENT_ACCESS={"AI-Gateway@codejourney":{"tier":"read","personal":true},
//                         "Fionn@codejourney":{"tier":"full","personal":true}}
// Unlisted identities and the legacy shared key: full tier, no personal access.
// Fails closed: a malformed policy denies every agent identity; a malformed entry denies that one.
//
// This module is pure (no database access) so the rules stay in one table that both MCP
// transports and the REST routes consult.

export type Tier = 'read' | 'write' | 'close' | 'full';

export interface Access {
  tier: Tier;
  personal: boolean;
}

const TIER_RANK: Record<Tier, number> = { read: 0, write: 1, close: 2, full: 3 };

// The personal-domain product. Its slug is matched exactly here and in fionn/hydrator.ts.
export const PERSONAL_PRODUCT_SLUG = 'LIFE';

// Statuses that close an issue: reaching them needs the close tier.
const CLOSING_STATUSES = new Set(['Done', 'Cancelled']);

// Change-log types that record or change governance: full tier only. Decision logs feed
// read_governing_context, so writing one is a governance act.
const GOVERNANCE_CHANGE_LOG_TYPES = new Set(['Decision', 'Config Change']);

// Every MCP tool's minimum tier. A tool missing from this table needs the full tier (fail
// closed), so a newly added tool is never silently open to restricted keys.
export const TOOL_TIERS: Record<string, Tier> = {
  // read: no writes of any kind
  read_issues: 'read',
  read_issue: 'read',
  hydrate_issue_context: 'read',
  read_governing_context: 'read',
  search: 'read',
  read_cycles: 'read',
  read_cycle: 'read',
  read_roadmaps: 'read',
  read_products: 'read',
  read_product_briefs: 'read',
  read_product_metrics: 'read',
  read_product_commits: 'read',
  read_projects: 'read',
  read_project: 'read',
  read_repositories: 'read',
  read_document: 'read',
  query_telemetry: 'read',
  brief_pcp_packet: 'read',
  refingerprint_pcp_packet: 'read', // pure: computes and returns file content, writes nothing
  // write: create issues and proposals; update descriptions, criteria and status
  create_issue: 'write',
  update_issue: 'write',
  update_status: 'write',
  check_criterion: 'write',
  decompose_issue: 'write',
  assign_issue_details: 'write',
  assign_issue_to_cycle: 'write',
  create_change_log: 'write', // Decision and Config Change need full (see requiredTier)
  // full: governance and lifecycle
  write_document: 'full',
  create_product: 'full',
  update_product: 'full',
  update_product_status: 'full',
  archive_product: 'full',
  create_project: 'full',
  update_project_status: 'full',
  create_cycle: 'full',
  update_cycle_status: 'full',
  create_repository: 'full',
  update_repository: 'full',
  archive_repository: 'full',
};

export const DEFAULT_ACCESS: Access = { tier: 'full', personal: false };

function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && value in TIER_RANK;
}

// Parses FLUXION_AGENT_ACCESS. Returns null when the policy is malformed (deny all agents).
export function parseAccessPolicy(raw: string | undefined): Map<string, Access | null> | null {
  const policy = new Map<string, Access | null>();
  if (!raw || !raw.trim()) return policy;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  for (const [identity, entry] of Object.entries(parsed as Record<string, unknown>)) {
    const e = entry as { tier?: unknown; personal?: unknown } | null;
    const valid = e && typeof e === 'object' && isTier(e.tier) && (e.personal === undefined || typeof e.personal === 'boolean');
    // An invalid entry denies that identity rather than falling back to the full default.
    policy.set(identity.trim(), valid ? { tier: e!.tier as Tier, personal: e!.personal === true } : null);
  }
  return policy;
}

// The access of one caller. `identity` is undefined for the legacy shared key.
// Returns null when the caller must be refused outright.
export function accessFor(identity: string | undefined, raw = process.env.FLUXION_AGENT_ACCESS): Access | null {
  if (!identity) return DEFAULT_ACCESS;
  const policy = parseAccessPolicy(raw);
  if (policy === null) return null;
  if (!policy.has(identity)) return DEFAULT_ACCESS;
  return policy.get(identity) ?? null;
}

function closes(status: unknown): boolean {
  return typeof status === 'string' && CLOSING_STATUSES.has(status.trim());
}

// The tier one call needs, from the tool and its arguments.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function requiredTier(tool: string, args: any): Tier {
  const base = TOOL_TIERS[tool] ?? 'full';
  if (base === 'full' || base === 'read') return base;
  if (tool === 'create_change_log' && typeof args?.type === 'string' && GOVERNANCE_CHANGE_LOG_TYPES.has(args.type.trim())) {
    return 'full';
  }
  const childCloses = Array.isArray(args?.children) && args.children.some((c: any) => closes(c?.status));
  if (closes(args?.status) || childCloses) return 'close';
  return base;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function tierAllows(access: Access, needed: Tier): boolean {
  return TIER_RANK[access.tier] >= TIER_RANK[needed];
}

export function toolVisible(access: Access, tool: string): boolean {
  return tierAllows(access, TOOL_TIERS[tool] ?? 'full');
}

// REST: reads are open to every tier; any other method needs the full tier (product CRUD,
// webhooks and trail-sync batches are not part of the restricted tiers).
export function restAllows(access: Access, method: string): boolean {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD' || access.tier === 'full';
}
