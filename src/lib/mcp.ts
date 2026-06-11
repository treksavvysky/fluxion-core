import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listToolSchemas, callTool } from './mcp-tools';

// The SDK binds one Server instance to one transport, so each SSE session
// gets its own Server. All instances serve the shared registry in
// src/lib/mcp-tools.ts (as does the HTTP JSON-RPC handler in pages/api/mcp).
export function createMcpServer(): Server {
  const server = new Server({
    name: 'fluxion-core-mcp',
    version: '1.0.0'
  }, {
    capabilities: {
      tools: {}
    }
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: listToolSchemas() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return callTool(request.params.name, request.params.arguments);
  });

  return server;
}
