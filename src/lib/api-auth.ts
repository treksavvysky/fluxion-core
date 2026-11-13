// Shared API-key authorization for REST, webhook, and MCP routes.
// Fails closed: when neither FLUXION_API_KEY nor FLUXION_AGENT_KEYS is
// configured, every request is rejected rather than silently accepting all
// traffic.
//
// Per-agent identity (FLX-133): FLUXION_AGENT_KEYS is a JSON object mapping
// identity tokens to keys, e.g.
//   FLUXION_AGENT_KEYS={"Claude@codejourney":"<key>","Codex@plannedintent-dev":"<key>"}
// A caller presenting an agent key is authenticated AND attributed — the
// resolved identity is stamped server-side into attribution fields
// (attestor, implementedBy, activity actors) instead of trusting client
// free-text. The legacy shared FLUXION_API_KEY remains valid but carries no
// identity, preserving pre-FLX-133 client behavior during migration.
//
// Capability tiers (FLX-149): each caller also resolves to an Access (tier +
// personal-domain flag) from FLUXION_AGENT_ACCESS; see src/lib/access.ts. A
// malformed policy entry refuses that identity outright (fail closed).

import { accessFor, restAllows, type Access } from './access';

export interface AuthResult {
  authorized: boolean;
  // `<AgentName>@<hostname>` token per the agent-attribution-protocol brief;
  // undefined for the legacy shared key (unattributed caller).
  identity?: string;
  // What the caller may do (FLX-149); set whenever authorized is true.
  access?: Access;
}

// key -> identity. Rebuilt per call: negligible cost at control-plane
// volume, and .env changes take effect on restart without cache staleness.
function agentKeyRegistry(): Map<string, string> {
  const raw = process.env.FLUXION_AGENT_KEYS;
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const map = new Map<string, string>();
    for (const [identity, key] of Object.entries(parsed)) {
      if (typeof key === 'string' && key.length > 0 && identity.trim()) {
        map.set(key, identity.trim());
      }
    }
    return map;
  } catch {
    // Malformed registry must not widen access: agent keys simply stop
    // resolving (fail closed for the registry, legacy key unaffected).
    console.error('[auth] FLUXION_AGENT_KEYS is not valid JSON — agent keys disabled');
    return new Map();
  }
}

export function resolveIdentity(providedKey: string | null | undefined): AuthResult {
  if (!providedKey) return { authorized: false };
  const identity = agentKeyRegistry().get(providedKey);
  if (identity) {
    const access = accessFor(identity);
    if (!access) {
      console.error(`[auth] FLUXION_AGENT_ACCESS is invalid for ${identity} — access refused`);
      return { authorized: false };
    }
    return { authorized: true, identity, access };
  }
  const legacy = process.env.FLUXION_API_KEY;
  if (legacy && providedKey === legacy) return { authorized: true, access: accessFor(undefined)! };
  return { authorized: false };
}

function providedKey(req: Request, bodyApiKey?: unknown): string | null {
  const authHeader = req.headers.get('authorization');
  return (
    (typeof bodyApiKey === 'string' ? bodyApiKey : null) ||
    req.headers.get('x-api-key') ||
    (authHeader ? authHeader.replace('Bearer ', '').trim() : null)
  );
}

export function isAuthorized(req: Request, bodyApiKey?: unknown): boolean {
  return resolveIdentity(providedKey(req, bodyApiKey)).authorized;
}

// REST guard: null when the request may proceed, else the 401 or 403 response.
// Reads are open to every tier; other methods need the full tier (FLX-149).
export function restGuard(req: Request, bodyApiKey?: unknown, extraKey?: string | null): Response | null {
  let auth = resolveIdentity(providedKey(req, bodyApiKey));
  if (!auth.authorized && extraKey) auth = resolveIdentity(extraKey);
  if (!auth.authorized) return unauthorizedResponse();
  if (!restAllows(auth.access!, req.method)) return forbiddenResponse();
  return null;
}

export function forbiddenResponse(): Response {
  return Response.json(
    { error: 'Forbidden: this API key may not make this request' },
    { status: 403 }
  );
}

export function unauthorizedResponse(): Response {
  return Response.json(
    { error: 'Unauthorized: missing or invalid API key' },
    { status: 401 }
  );
}
