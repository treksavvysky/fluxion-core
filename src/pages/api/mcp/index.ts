import { createMcpServer } from '@/lib/mcp';
import { addTransport, removeTransport } from '@/lib/mcp-state';
import { listToolSchemas, callTool, listPromptSchemas, getPrompt } from '@/lib/mcp-tools';
import { resolveIdentity } from '@/lib/api-auth';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { ServerResponse } from 'http';
import { randomUUID } from 'node:crypto';

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Fail closed when no key is configured. Per-agent keys (FLX-133) resolve
  // to an identity that is threaded into every tool call from this request;
  // the legacy shared FLUXION_API_KEY authenticates without an identity.
  const providedKey = first(req.headers['x-api-key'] as string | string[] | undefined) || first(req.query.token) || first(req.query['api-key']);
  const auth = resolveIdentity(providedKey);
  if (!auth.authorized) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
  }

  // Support stateless HTTP JSON-RPC directly on the handshake URL /api/mcp
  if (req.method === 'POST') {
    const request = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // JSON-RPC notifications and responses carry no `id`. The MCP Streamable
    // HTTP transport requires the server to acknowledge these with HTTP 202 and
    // an EMPTY body. Emitting a synthetic {jsonrpc,result:null} object (no id,
    // no method) matches no JsonRpcMessage variant and is fatal to strict
    // clients — e.g. Codex's Rust rmcp client dies with "data did not match any
    // variant of untagged enum JsonRpcMessage, when send initialized
    // notification". Lenient JS clients ignored the bogus body; rmcp does not.
    if (request && typeof request.id === 'undefined') {
      return res.status(202).end();
    }

    res.setHeader('Content-Type', 'application/json');

    // Stateless HTTP JSON-RPC handler (used by HTTP-only MCP clients).
    // Tools are listed and dispatched from the shared registry in
    // src/lib/mcp-tools.ts — the same surface the SSE server exposes.
    try {
      const method = request?.method;
      const id = request?.id;

      if (method === 'initialize') {
        // Advertise a session id so Streamable HTTP clients can attach it to
        // subsequent requests. The handler is stateless and does not require
        // it, but compliant clients expect the header on the initialize reply.
        res.setHeader('Mcp-Session-Id', randomUUID());
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              prompts: {}
            },
            serverInfo: {
              name: 'fluxion-core-mcp',
              version: '1.0.0'
            }
          }
        });
      }

      if (method === 'tools/list') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: { tools: listToolSchemas() }
        });
      }

      if (method === 'tools/call') {
        const result = await callTool(request.params?.name, request.params?.arguments, { identity: auth.identity });
        return res.status(200).json({ jsonrpc: '2.0', id, result });
      }

      if (method === 'prompts/list') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: { prompts: listPromptSchemas() }
        });
      }

      if (method === 'prompts/get') {
        const result = getPrompt(request.params?.name);
        return res.status(200).json({ jsonrpc: '2.0', id, result });
      }

      return res.status(404).json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      });

    } catch (err: unknown) {
      return res.status(500).json({
        jsonrpc: '2.0',
        id: request?.id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) }
      });
    }
  }

  if (req.method !== 'GET') return res.status(405).end();

  // Prevent response buffering and stream dropping (Nginx, Next.js dev server, CDNs)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Per-session transport (FLX-113): each connection gets its own Server +
  // transport, registered by sessionId. Concurrent clients coexist; a new
  // connection no longer tears down existing ones. The SDK appends
  // sessionId=<uuid> to the advertised messages endpoint automatically.
  // The identity resolved at the handshake is bound to the session for its
  // lifetime — message POSTs authenticate but cannot re-attribute it.
  const server = createMcpServer(auth.identity);
  const transport = new SSEServerTransport(`/api/mcp/messages?token=${providedKey || ''}`, res as unknown as ServerResponse);
  addTransport(transport);

  // Periodic keep-alive heartbeat ping every 15 seconds to prevent idle socket drop
  const flushable = res as NextApiResponse & { flush?: () => void };
  const heartbeatInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(':\n\n'); // SSE comment line
      flushable.flush?.();
    }
  }, 15000);

  // Deregister on disconnect. res.socket is not reliably populated under
  // next start, so hook the SDK's own close signal (fired from its
  // res.on('close') listener) plus the response 'close' event directly.
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeatInterval);
    removeTransport(transport.sessionId);
  };
  server.onclose = cleanup;
  res.on('close', cleanup);

  await server.connect(transport);

  if (res.flushHeaders) {
    res.flushHeaders();
  }
}

// Next.js API config to allow long-running asynchronous execution streams
export const config = {
  api: {
    externalResolver: true,
  },
};
