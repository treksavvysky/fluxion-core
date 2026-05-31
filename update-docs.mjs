import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("Updating Documentation Hub articles to reflect MVP features...");

  // 1. Update Fluxion Architecture Blueprint
  const blueprintContent = `# Fluxion Architecture Blueprint

Fluxion is engineered as an **AI-collaborative DevOps Control Tower**. Unlike traditional management systems (like Linear), which are passive status trackers, Fluxion actively orchestrates the build, test, and release cycles.

## Core Pillars
1. **Unified Dashboard**: Live environment and build health widgets displayed adjacent to task grids.
2. **Event-Driven Automation Cockpit (Pillar B)**: A reactive rules engine that evaluates system events (e.g. build failures, health outages) and automatically dispatches self-healing AI agents or registers audit logs.
3. **Documentation Hub (Pillar C)**: Stateless, markdown-rendered context memory linked to Products, Repositories, and Projects for human/AI pair programming.
4. **Operations & Auditing (Pillar D)**: Strict, auditable Change Control tracking of migrations and deploys.
5. **Multi-Index command search (Cmd K)**: Seamless keyboard-only search across issues, wikis, and Change Control logs.

## Component Topology
* **Next.js 16 (App Router)**: Main UI and server operations.
* **Prisma & Neon Postgres**: Durable relational state management.
* **Model Context Protocol (MCP)**: Two-way agent integration endpoint.`;

  await prisma.document.upsert({
    where: { slug: 'fluxion-architecture-blueprint' },
    update: { content: blueprintContent },
    create: {
      title: 'Fluxion Architecture Blueprint',
      slug: 'fluxion-architecture-blueprint',
      category: 'Architecture',
      content: blueprintContent
    }
  });
  console.log("Updated: Fluxion Architecture Blueprint");

  // 2. Update Model Context Protocol Integration Spec
  const mcpContent = `# Model Context Protocol (MCP) Integration SPEC

Fluxion utilizes the **Model Context Protocol (MCP)** to allow AI coding assistants to view system telemetry, search issues, write documentation, and register logs.

## Endpoint Architecture
* **Stateful SSE Routing**: Exposes a Server-Sent Events channel on \`/api/mcp\` for real-time streaming transport.
* **Stateless JSON-RPC Fallback**: Exposes standard POST handlers for stateless message routing.
* **Proxy Resiliency**: Implements \`X-Accel-Buffering: no\` to bypass intermediate reverse-proxy caching delays.

## Production-Grade Agent Tools
* \`read_issues\`: View current backlog.
* \`create_issue\`: Create unit of work tickets.
* \`update_status\`: Transition issue statuses (Todo, In Progress, Done).
* \`read_document\`: Read technical wiki documentation articles from the Doc Hub for context injection.
* \`write_document\`: Create or update technical wiki articles.
* \`create_change_log\`: Register Change Control audit logs (Deployments, Migrations).
* \`query_telemetry\`: Query environment statuses, build records, and system-wide activities.`;

  await prisma.document.upsert({
    where: { slug: 'mcp-integration-spec' },
    update: { content: mcpContent },
    create: {
      title: 'Model Context Protocol (MCP) Integration',
      slug: 'mcp-integration-spec',
      category: 'API',
      content: mcpContent
    }
  });
  console.log("Updated: MCP Integration Spec");

  // 3. Update Neon Database Schema Guide
  const schemaContent = `# Neon Database Schema Guide

This document catalogs the relationships and schema topology in our Serverless Neon Postgres cluster.

## Database Relationships
* **Product**: The topmost container. Owns Projects, Repositories, Roadmaps, and Issues.
* **Repository**: Tracks actual code. Linked to Product and possesses builds and issues.
* **Issue**: Core unit of work. Maps back to Product, Project, Repo, and Cycle.
* **ChangeLog**: Auditable operations history. Documents deployments and schema migrations.
* **Document**: Markdown system specs natively linked to scope fields for context injection.
* **AutomationRule**: Event-driven automation rule representing trigger-condition-action mappings.

## Scaling Configurations
Our connection string utilizes \`sslmode=require\` and utilizes a serverless connection pooler to prevent idle socket leakage during rapid serverless scale-outs.`;

  await prisma.document.upsert({
    where: { slug: 'neon-database-schema-guide' },
    update: { content: schemaContent },
    create: {
      title: 'Neon Database Schema Guide',
      slug: 'neon-database-schema-guide',
      category: 'Schema',
      content: schemaContent
    }
  });
  console.log("Updated: Neon Database Schema Guide");
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
