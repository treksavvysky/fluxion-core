import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listToolSchemas, callTool } from './mcp-tools';

export const mcpServer = new Server({
  name: 'fluxion-core-mcp',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {}
  }
});

// Both transports (SSE here, HTTP JSON-RPC in pages/api/mcp) serve the
// shared registry in src/lib/mcp-tools.ts.
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: listToolSchemas() };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  return callTool(request.params.name, request.params.arguments);
});
