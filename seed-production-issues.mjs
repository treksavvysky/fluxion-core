import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.issue.count();
  
  const issuesToCreate = [
    {
      title: "Implement Event-Driven Automation Engine (Pillar B)",
      description: "Create an event-driven rule execution system in Fluxion Core. When environment builds fail or Pull Requests are opened, trigger automatic AI agent delegation, self-repair subagents, or security audit logs.",
      priority: "Critical",
      status: "Todo"
    },
    {
      title: "Deploy Operational Telemetry Webhook Ingest Endpoint",
      description: "Develop a secure POST endpoint at `/api/webhooks/telemetry` to receive real-time branch push, health check, and build status telemetry from GitHub Actions and Vercel, transitioning away from static mocks.",
      priority: "High",
      status: "Todo"
    },
    {
      title: "Expand Unified Command Palette (Cmd K) Multi-Index Search",
      description: "Extend the CMDK command drawer to perform unified, multi-index searches across Issues, Documentation Hub articles, and Change Control deployment logs to enable keyboard-only workspace navigation.",
      priority: "Medium",
      status: "Todo"
    },
    {
      title: "Implement Production-Grade MCP Tool Handlers for AI Agents",
      description: "Implement high-fidelity Model Context Protocol (MCP) handlers for `read_document`, `write_document`, `create_change_log`, and `query_telemetry` so external AI agents have full workspace capabilities.",
      priority: "High",
      status: "Todo"
    }
  ];

  console.log(`Current issue count: ${count}`);
  
  for (let i = 0; i < issuesToCreate.length; i++) {
    const item = issuesToCreate[i];
    const identifier = `FLX-${101 + count + i}`;
    
    // Check if identifier already exists to avoid collisions
    const existing = await prisma.issue.findUnique({
      where: { identifier }
    });
    
    if (existing) {
      console.log(`Issue ${identifier} already exists, skipping.`);
      continue;
    }

    const created = await prisma.issue.create({
      data: {
        identifier,
        title: item.title,
        description: item.description,
        priority: item.priority,
        status: item.status
      }
    });
    console.log(`Created Issue: ${created.identifier} - ${created.title}`);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
