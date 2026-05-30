import type { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const globalObj = global as unknown as { activeTransport: SSEServerTransport | null };

export const mcpState = {
  get transport() { return globalObj.activeTransport; },
  set transport(t: SSEServerTransport | null) { globalObj.activeTransport = t; }
};
