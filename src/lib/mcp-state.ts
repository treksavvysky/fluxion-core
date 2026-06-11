import type { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

// Per-session SSE transport registry (FLX-113). Each SSE connection gets its
// own transport keyed by the SDK-generated sessionId, so concurrent clients
// and reconnects no longer clobber a single global connection. Stored on
// globalThis to survive Next.js dev-mode module reloads.

const globalObj = global as unknown as { mcpTransports: Map<string, SSEServerTransport> | undefined };

function transports(): Map<string, SSEServerTransport> {
  if (!globalObj.mcpTransports) {
    globalObj.mcpTransports = new Map();
  }
  return globalObj.mcpTransports;
}

export function addTransport(transport: SSEServerTransport): void {
  transports().set(transport.sessionId, transport);
}

export function removeTransport(sessionId: string): void {
  transports().delete(sessionId);
}

// Resolves the transport for a message POST. When the sessionId is missing
// or stale but exactly one session is live, route to it: EventSource clients
// auto-reconnect after stream drops (boot races, network blips) and receive a
// fresh server-side sessionId, but the SDK client keeps POSTing the old one.
// With a single live session that healing is unambiguous; with several,
// strict routing applies and an unknown sessionId is rejected.
export function getTransport(sessionId: string | undefined): SSEServerTransport | undefined {
  const map = transports();
  if (sessionId) {
    const exact = map.get(sessionId);
    if (exact) return exact;
  }
  if (map.size === 1) {
    const sole = map.values().next().value;
    if (sessionId) {
      console.log(`[MCP] Healing stale sessionId ${sessionId} -> sole live session ${sole?.sessionId}`);
    }
    return sole;
  }
  return undefined;
}

export function transportCount(): number {
  return transports().size;
}
