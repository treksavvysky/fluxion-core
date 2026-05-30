'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function getDocuments() {
  const count = await prisma.document.count();
  if (count === 0) {
    await seedDocuments();
  }

  return prisma.document.findMany({
    orderBy: { category: 'asc' },
    include: {
      product: { select: { name: true } },
      repo: { select: { name: true } },
      project: { select: { name: true } },
    },
  });
}

export async function getDocumentBySlug(slug: string) {
  return prisma.document.findUnique({
    where: { slug },
    include: {
      product: { select: { name: true } },
      repo: { select: { name: true } },
      project: { select: { name: true } },
    },
  });
}

export async function createDocument(data: {
  title: string;
  slug: string;
  content: string;
  category: string;
  productId?: string;
  repoId?: string;
  projectId?: string;
}) {
  const doc = await prisma.document.create({
    data: {
      title: data.title,
      slug: data.slug,
      content: data.content,
      category: data.category,
      productId: data.productId || null,
      repoId: data.repoId || null,
      projectId: data.projectId || null,
    },
  });
  revalidatePath('/docs');
  return doc;
}

export async function submitDocument(formData: FormData) {
  const title = formData.get('title') as string;
  const category = formData.get('category') as string || 'General';
  const content = formData.get('content') as string;
  const productId = formData.get('productId') as string;
  const repoId = formData.get('repoId') as string;
  const projectId = formData.get('projectId') as string;

  if (!title || !content) {
    throw new Error('Title and Content are required.');
  }

  // Generate unique slug
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');

  // Ensure unique slug
  const existing = await prisma.document.findUnique({ where: { slug } });
  if (existing) {
    slug = `${slug}-${Math.floor(Math.random() * 1000)}`;
  }

  await prisma.document.create({
    data: {
      title,
      slug,
      content,
      category,
      productId: productId && productId !== 'none' ? productId : null,
      repoId: repoId && repoId !== 'none' ? repoId : null,
      projectId: projectId && projectId !== 'none' ? projectId : null,
    },
  });

  revalidatePath('/docs');
  redirect(`/docs?slug=${slug}`);
}

async function seedDocuments() {
  const repo = await prisma.repository.findFirst();
  const product = await prisma.product.findFirst();
  const project = await prisma.project.findFirst();

  const repoId = repo?.id || null;
  const productId = product?.id || null;
  const projectId = project?.id || null;

  const mockDocs = [
    {
      title: 'Fluxion Architecture Blueprint',
      slug: 'fluxion-architecture-blueprint',
      category: 'Architecture',
      content: `# Fluxion Architecture Blueprint

Fluxion is engineered as an **AI-collaborative DevOps Control Tower**. Unlike traditional management systems (like Linear), which are passive status trackers, Fluxion actively orchestrates the build, test, and release cycles.

## Core Pillars
1. **Unified Dashboard**: Live environment and build health widgets displayed adjacent to task grids.
2. **First-Class AI Agency**: The coding assistant (Antigravity) interacts as a full team member, communicating status updates and updating wikis.
3. **Operations & Auditing**: Strict, auditable Change Control tracking of migrations and deploys.

## Component Topology
* **Next.js 16 (App Router)**: Main UI and server operations.
* **Prisma & Neon Postgres**: Durable relational state management.
* **Model Context Protocol (MCP)**: Two-way agent integration endpoint.`,
      productId,
      repoId,
      projectId,
    },
    {
      title: 'Neon Database Schema Guide',
      slug: 'neon-database-schema-guide',
      category: 'Schema',
      content: `# Neon Database Schema Guide

This document catalogs the relationships and schema topology in our Serverless Neon Postgres cluster.

## Database Relationships
* **Product**: The topmost container. Owns Projects, Repositories, Roadmaps, and Issues.
* **Repository**: Tracks actual code. Linked to Product and possesses builds and issues.
* **Issue**: Core unit of work. Maps back to Product, Project, Repo, and Cycle.
* **ChangeLog**: Auditable operations history. Documents deployments and schema migrations.
* **Document**: Markdown system specs natively linked to scope fields for context injection.

## Scaling Configurations
Our connection string utilizes \`sslmode=require\` and utilizes a serverless connection pooler to prevent idle socket leakage during rapid serverless scale-outs.`,
      productId,
      repoId,
    },
    {
      title: 'Model Context Protocol (MCP) Integration',
      slug: 'mcp-integration-spec',
      category: 'API',
      content: `# Model Context Protocol (MCP) Integration SPEC

Fluxion utilizes the **Model Context Protocol (MCP)** to allow AI coding assistants to view system telemetry, search issues, write documentation, and register logs.

## Endpoint Architecture
* **Stateful SSE Routing**: Exposes a Server-Sent Events channel on \`/api/mcp\` for real-time streaming transport.
* **Stateless JSON-RPC Fallback**: Exposes standard POST handlers for stateless message routing.
* **Proxy Resiliency**: Implements \`X-Accel-Buffering: no\` to bypass intermediate reverse-proxy caching delays.

## Core Agent Tools
* \`list_issues\`: View current backlog.
* \`create_change_log\`: Automates registry of deploys.
* \`inject_doc_context\`: Pulls matching markdown wikis to eliminate context hallucinations.`,
      productId,
      repoId,
    },
    {
      title: 'Antigravity Collaboration Guide',
      slug: 'antigravity-collaboration-guide',
      category: 'Guides',
      content: `# Antigravity Collaboration Guide

This guide outlines the protocol for human developers and the **Antigravity AI Agent** to pair program effectively inside the Fluxion ecosystem.

## Collaboration Best Practices
1. **Write Clean Descriptions**: The AI reads issue descriptions to bootstrap its coding context. Use clear markdown outlines.
2. **Leverage the Change Log**: When Antigravity executes database schema modifications or releases, it registers a ChangeLog event so developers are notified.
3. **Update Docs Proactively**: High-integrity codebases require updated documentation. Use Antigravity to write documentation updates right alongside code changes.

## Automatic Telemetry Handlers
If a build fails, the webhook triggers a self-repair routine where Antigravity inspects compilation logs, edits files to fix the error, and restarts the environment.`,
      productId,
    },
  ];

  for (const doc of mockDocs) {
    await prisma.document.create({
      data: doc,
    });
  }
}
