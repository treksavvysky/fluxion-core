import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next start` gzips responses by default, which buffers the MCP SSE
  // stream (/api/mcp) into silence in production. This is a LAN/Tailscale
  // control plane; a working event stream beats compression.
  compress: false,
};

export default nextConfig;
