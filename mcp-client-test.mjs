import * as es from "eventsource";
global.EventSource = es.EventSource || es.default || es;

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

async function run() {
  console.log("Connecting to Fluxion Core MCP Server (SSE)...");
  
  // Use http://127.0.0.1:3002 to hit our Next.js docker deployment directly with token auth
  const transport = new SSEClientTransport(new URL("http://localhost:3002/api/mcp?token=fluxion_secret_key_2026"));
  
  const client = new Client({
    name: "test-client",
    version: "1.0.0"
  });

  await client.connect(transport);
  console.log("Connected successfully!");

  console.log("Executing 'read_issues' tool...");
  const result = await client.callTool({
    name: "read_issues",
    arguments: {}
  });

  console.log("Fluxion DB Array:");
  console.log(result.content[0].text);
  
  process.exit(0);
}

run().catch(console.error);
