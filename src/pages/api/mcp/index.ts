import { mcpServer } from '@/lib/mcp';
import { mcpState } from '@/lib/mcp-state';
import { listToolSchemas, callTool } from '@/lib/mcp-tools';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { ServerResponse } from 'http';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Fail closed when FLUXION_API_KEY is not configured
  const providedKey = req.headers['x-api-key'] || req.query.token || req.query['api-key'];
  const apiKey = process.env.FLUXION_API_KEY;
  if (!apiKey || providedKey !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
  }

  // Support stateless HTTP JSON-RPC directly on the handshake URL /api/mcp
  if (req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');
    const request = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Stateless HTTP JSON-RPC handler (used by HTTP-only MCP clients).
    // Tools are listed and dispatched from the shared registry in
    // src/lib/mcp-tools.ts — the same surface the SSE server exposes.
    try {
      const method = request?.method;
      const id = request?.id;

      if (method === 'initialize') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'fluxion-core-mcp',
              version: '1.0.0'
            }
          }
        });
      }

      if (method === 'notifications/initialized') {
        return res.status(200).json({ jsonrpc: '2.0', result: null });
      }

      if (method === 'tools/list') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: { tools: listToolSchemas() }
        });
      }

      if (method === 'tools/call') {
        const result = await callTool(request.params?.name, request.params?.arguments);
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

  if (mcpState.transport) {
    try {
      await mcpServer.close();
    } catch {
      // previous transport already torn down
    }
  }

  const transport = new SSEServerTransport(`/api/mcp/messages?token=${providedKey || ''}`, res as unknown as ServerResponse);
  mcpState.transport = transport;

  await mcpServer.connect(transport);

  if (res.flushHeaders) {
    res.flushHeaders();
  }

  // Periodic keep-alive heartbeat ping every 15 seconds to prevent idle socket drop
  const flushable = res as NextApiResponse & { flush?: () => void };
  const heartbeatInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(':\n\n'); // SSE comment line
      flushable.flush?.();
    }
  }, 15000);

  res.socket?.on('close', () => {
    clearInterval(heartbeatInterval);
    mcpState.transport = null;
  });
}

// Next.js API config to allow long-running asynchronous execution streams
export const config = {
  api: {
    externalResolver: true,
  },
};
