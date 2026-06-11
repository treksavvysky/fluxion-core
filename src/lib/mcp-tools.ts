import { prisma } from './prisma';
import { createNamespacedIssue, assertValidTransition, allowedNextStatuses, VALID_STATUSES } from './issues';
import { computeProductMetrics } from './metrics';
import { multiIndexSearch } from './search';
import { revalidatePath } from 'next/cache';

// Single source of truth for the MCP tool surface. Both servers — the SSE
// server (src/lib/mcp.ts) and the stateless HTTP JSON-RPC handler
// (src/pages/api/mcp/index.ts) — list and dispatch from this registry, so
// the two transports can never drift apart again.

export interface ToolResult {
  [key: string]: unknown; // index signature required by the MCP SDK's ServerResult
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: any) => Promise<ToolResult>;
}

function text(t: string): ToolResult {
  return { content: [{ type: 'text', text: t }] };
}

function json(v: unknown): ToolResult {
  return text(JSON.stringify(v, null, 2));
}

function revalidate(...paths: string[]) {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      // revalidation is best-effort outside a request scope
    }
  }
}

// Resolves an issue by UUID or human identifier (FLX-112 / TRAIL-SYNC-3).
async function resolveIssue(args: { issueId?: string; identifier?: string }) {
  if (args.issueId) {
    return prisma.issue.findUnique({ where: { id: args.issueId } });
  }
  if (args.identifier) {
    return prisma.issue.findUnique({ where: { identifier: args.identifier.toUpperCase().trim() } });
  }
  return null;
}

// Resolves a product by UUID or slug.
async function resolveProduct(args: { productId?: string; productSlug?: string }) {
  if (args.productId) {
    return prisma.product.findUnique({ where: { id: args.productId } });
  }
  if (args.productSlug) {
    return prisma.product.findUnique({ where: { slug: args.productSlug.toUpperCase().trim() } });
  }
  return null;
}

export const mcpTools: ToolDef[] = [
  {
    name: 'read_issues',
    description: 'Read the backlog of open issues and tickets inside the Fluxion Core database.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status (e.g., Todo, In Progress)' }
      }
    },
    handler: async (args) => {
      const issues = await prisma.issue.findMany({
        where: args?.status ? { status: args.status } : undefined,
        include: {
          parent: { select: { identifier: true } },
          _count: { select: { children: true } }
        }
      });
      return json(issues);
    }
  },
  {
    name: 'read_issue',
    description: 'Read one issue in full, including the agent contract fields (context, acceptanceCriteria, technicalIntent), parent/children hierarchy, assignments, and the statuses it may legally transition to. The intended first call before executing a task.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The UUID of the issue' },
        identifier: { type: 'string', description: 'The human identifier (e.g. FLX-117), as an alternative to issueId' }
      }
    },
    handler: async (args) => {
      const resolved = await resolveIssue(args ?? {});
      if (!resolved) throw new Error('Issue not found: provide a valid issueId or identifier');
      const issue = await prisma.issue.findUnique({
        where: { id: resolved.id },
        include: {
          product: { select: { slug: true, name: true } },
          project: { select: { name: true } },
          repo: { select: { name: true } },
          cycle: { select: { name: true } },
          roadmap: { select: { name: true } },
          parent: { select: { identifier: true, title: true, status: true } },
          children: { select: { identifier: true, title: true, status: true }, orderBy: { identifier: 'asc' } }
        }
      });
      return json({ ...issue, allowedNextStatuses: allowedNextStatuses(issue!.status) });
    }
  },
  {
    name: 'update_status',
    description: `Update the status of a specific issue. Statuses: ${VALID_STATUSES.join(', ')}. Transitions are enforced; an illegal transition returns the allowed next states.`,
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The UUID of the issue' },
        status: { type: 'string', description: 'The new status' }
      },
      required: ['issueId', 'status']
    },
    handler: async (args) => {
      if (!args?.issueId || !args?.status) throw new Error('Missing args');
      const issue = await prisma.issue.findUnique({ where: { id: args.issueId } });
      if (!issue) throw new Error(`Issue not found for id: ${args.issueId}`);
      assertValidTransition(issue.status, args.status);
      const updated = await prisma.issue.update({
        where: { id: args.issueId },
        data: { status: args.status }
      });
      revalidate('/');
      return text(`Successfully updated issue ${updated.identifier} to ${updated.status}`);
    }
  },
  {
    name: 'update_issue',
    description: `Update the fields of an existing issue: title, description, priority, status (transitions enforced; statuses: ${VALID_STATUSES.join(', ')}), the agent contract fields (context, acceptanceCriteria, technicalIntent), or the parent issue. Identify the issue by UUID or by its human identifier (e.g. FLX-112).`,
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The UUID of the issue' },
        identifier: { type: 'string', description: 'The human identifier of the issue (e.g. FLX-112), as an alternative to issueId' },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        priority: { type: 'string', description: 'New priority (Low, Medium, High, Critical)' },
        status: { type: 'string', description: 'New status (transition is validated against the current state)' },
        context: { type: 'string', description: 'Agent contract: why this work exists and the surrounding state an executor must know (markdown)' },
        acceptanceCriteria: { type: 'string', description: 'Agent contract: verifiable conditions that define Done (markdown)' },
        technicalIntent: { type: 'string', description: 'Agent contract: intended approach or constraints (markdown)' },
        parentIdentifier: { type: 'string', description: 'Identifier of the parent issue (e.g. FLX-117), or "none" to detach' }
      }
    },
    handler: async (args) => {
      const issue = await resolveIssue(args ?? {});
      if (!issue) throw new Error('Issue not found: provide a valid issueId or identifier');

      const data: Record<string, string | null> = {};
      if (typeof args.title === 'string' && args.title.trim()) data.title = args.title.trim();
      if (typeof args.description === 'string') data.description = args.description;
      if (typeof args.context === 'string') data.context = args.context;
      if (typeof args.acceptanceCriteria === 'string') data.acceptanceCriteria = args.acceptanceCriteria;
      if (typeof args.technicalIntent === 'string') data.technicalIntent = args.technicalIntent;
      if (typeof args.priority === 'string' && args.priority.trim()) data.priority = args.priority.trim();
      if (typeof args.status === 'string' && args.status.trim()) {
        assertValidTransition(issue.status, args.status.trim());
        data.status = args.status.trim();
      }
      if (typeof args.parentIdentifier === 'string' && args.parentIdentifier.trim()) {
        const ref = args.parentIdentifier.trim();
        if (ref.toLowerCase() === 'none') {
          data.parentId = null;
        } else {
          const parent = await prisma.issue.findUnique({ where: { identifier: ref.toUpperCase() } });
          if (!parent) throw new Error(`Parent issue not found for identifier: ${ref}`);
          if (parent.id === issue.id) throw new Error('An issue cannot be its own parent');
          data.parentId = parent.id;
        }
      }
      if (Object.keys(data).length === 0) {
        throw new Error('No updatable fields provided (title, description, priority, status, context, acceptanceCriteria, technicalIntent, parentIdentifier)');
      }

      const updated = await prisma.issue.update({ where: { id: issue.id }, data });
      revalidate('/');
      return text(`Successfully updated issue ${updated.identifier} (${Object.keys(data).join(', ')})`);
    }
  },
  {
    name: 'create_issue',
    description: `Create a new issue inside the Fluxion Core database. The issue identifier is minted under the product namespace (e.g. TRAIL-SYNC-4); without a product it lands in the FLX workspace. Provide the agent contract fields (context, acceptanceCriteria, technicalIntent) whenever the issue is intended for autonomous execution. Statuses: ${VALID_STATUSES.join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The title of the issue' },
        description: { type: 'string', description: 'Detailed description of the issue' },
        context: { type: 'string', description: 'Agent contract: why this work exists and the surrounding state an executor must know (markdown)' },
        acceptanceCriteria: { type: 'string', description: 'Agent contract: verifiable conditions that define Done (markdown)' },
        technicalIntent: { type: 'string', description: 'Agent contract: intended approach or constraints (markdown)' },
        priority: { type: 'string', description: 'Priority level (Low, Medium, High, Critical)' },
        status: { type: 'string', description: 'Initial status (default Todo; use Triage for unvetted work)' },
        parentIdentifier: { type: 'string', description: 'Identifier of the parent issue (e.g. FLX-117) to attach this as a child' },
        cycleId: { type: 'string', description: 'Optional UUID of the cycle to associate the issue with' },
        roadmapId: { type: 'string', description: 'Optional UUID of the roadmap to associate the issue with' },
        productId: { type: 'string', description: 'Optional UUID of the product whose namespace the issue belongs to' },
        productSlug: { type: 'string', description: 'Optional product slug (e.g. TRAIL-SYNC) as an alternative to productId' }
      },
      required: ['title']
    },
    handler: async (args) => {
      if (!args?.title) throw new Error('Missing title');
      const newIssue = await createNamespacedIssue({
        title: args.title,
        description: args.description,
        context: args.context,
        acceptanceCriteria: args.acceptanceCriteria,
        technicalIntent: args.technicalIntent,
        priority: args.priority,
        status: args.status,
        parentIdentifier: args.parentIdentifier,
        cycleId: args.cycleId,
        roadmapId: args.roadmapId,
        productId: args.productId,
        productSlug: args.productSlug
      });
      revalidate('/', '/cycles');
      return text(`Successfully created issue ${newIssue.identifier}: ${newIssue.title}`);
    }
  },
  {
    name: 'search',
    description: 'Multi-index workspace search across Issues, Documents, and Change Control logs. Matches titles, descriptions, identifiers, content, and categories (case-insensitive).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        limit: { type: 'number', description: 'Max results per index (default 10)' }
      },
      required: ['query']
    },
    handler: async (args) => {
      if (!args?.query || typeof args.query !== 'string') throw new Error('Missing query');
      const take = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 50) : 10;
      const results = await multiIndexSearch(args.query, take);
      return json(results);
    }
  },
  {
    name: 'read_cycles',
    description: 'Read the list of active or upcoming development cycles/sprints.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const cycles = await prisma.cycle.findMany({ orderBy: { startDate: 'desc' } });
      return json(cycles);
    }
  },
  {
    name: 'read_roadmaps',
    description: 'Read the strategic roadmaps and epics.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const roadmaps = await prisma.roadmap.findMany({ orderBy: { createdAt: 'desc' } });
      return json(roadmaps);
    }
  },
  {
    name: 'assign_issue_to_cycle',
    description: 'Assign a specific issue to a development cycle/sprint.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The UUID of the issue' },
        cycleId: { type: 'string', description: 'The UUID of the cycle, or "none" / null to unassign' }
      },
      required: ['issueId', 'cycleId']
    },
    handler: async (args) => {
      if (!args?.issueId || args?.cycleId === undefined) throw new Error('Missing issueId or cycleId');
      const targetCycleId = args.cycleId === 'none' || args.cycleId === '' ? null : args.cycleId;
      const updated = await prisma.issue.update({
        where: { id: args.issueId },
        data: { cycleId: targetCycleId }
      });
      revalidate('/', '/cycles');
      return text(`Successfully updated issue ${updated.identifier} cycle to ${targetCycleId || 'None'}`);
    }
  },
  {
    name: 'read_products',
    description: 'Read the list of products from the Fluxion Core database.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const products = await prisma.product.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { projects: true, repos: true, issues: true } }
        }
      });
      return json(products);
    }
  },
  {
    name: 'read_product_metrics',
    description: 'Read operational rollup metrics for a product: open/closed issues, defect counts, priority-weighted technical-debt score, and roadmap completion percentage. Identify the product by UUID or slug.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'The UUID of the product' },
        productSlug: { type: 'string', description: 'The product slug (e.g. TRAIL-SYNC), as an alternative to productId' }
      }
    },
    handler: async (args) => {
      const product = await resolveProduct(args ?? {});
      if (!product) throw new Error('Product not found: provide a valid productId or productSlug');
      const metrics = await computeProductMetrics(product.id);
      return json({ product: { id: product.id, slug: product.slug, name: product.name, status: product.status }, metrics });
    }
  },
  {
    name: 'create_product',
    description: 'Create a new product inside the Fluxion Core database.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the product' },
        description: { type: 'string', description: 'Detailed description of the product' }
      },
      required: ['name']
    },
    handler: async (args) => {
      if (!args?.name) throw new Error('Missing name');

      let slugBase = args.name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
      if (slugBase.length > 10) slugBase = slugBase.substring(0, 10);
      if (slugBase.length < 2) slugBase = 'PROD';

      let slug = slugBase;
      const existing = await prisma.product.findUnique({ where: { slug } });
      if (existing) {
        slug = `${slugBase.substring(0, 6)}-${Math.floor(Math.random() * 1000)}`;
      }

      const p = await prisma.product.create({
        data: {
          name: args.name,
          slug,
          description: args.description || null,
          status: 'Active'
        }
      });
      revalidate('/');
      return text(`Successfully created product ${p.name} with slug ${p.slug}`);
    }
  },
  {
    name: 'archive_product',
    description: 'Soft-delete a product by setting its status to Archived (metadata and history are preserved; archived products are read-only). Identify the product by UUID or slug.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'The UUID of the product' },
        productSlug: { type: 'string', description: 'The product slug (e.g. TEST), as an alternative to productId' }
      }
    },
    handler: async (args) => {
      const product = await resolveProduct(args ?? {});
      if (!product) throw new Error('Product not found: provide a valid productId or productSlug');
      if (product.status === 'Archived') {
        return text(`Product ${product.slug} is already archived.`);
      }
      const archived = await prisma.product.update({
        where: { id: product.id },
        data: { status: 'Archived' }
      });
      revalidate('/', '/products');
      return text(`Successfully archived product ${archived.name} (${archived.slug})`);
    }
  },
  {
    name: 'read_projects',
    description: 'Read the list of active or upcoming projects (temporal milestones).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const projects = await prisma.project.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { name: true } },
          _count: { select: { issues: true } }
        }
      });
      return json(projects);
    }
  },
  {
    name: 'create_project',
    description: 'Create a new project (temporal milestone) inside the Fluxion Core database.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the project' },
        description: { type: 'string', description: 'Detailed description of the project' },
        productId: { type: 'string', description: 'Optional UUID of the product this project belongs to' },
        status: { type: 'string', description: 'Initial status (Planned, Active, Completed, Cancelled)' }
      },
      required: ['name']
    },
    handler: async (args) => {
      if (!args?.name) throw new Error('Missing name');
      const proj = await prisma.project.create({
        data: {
          name: args.name,
          description: args.description || null,
          status: args.status || 'Planned',
          productId: args.productId || null
        }
      });
      revalidate('/');
      return text(`Successfully created project ${proj.name}`);
    }
  },
  {
    name: 'read_repositories',
    description: 'Read the list of codebase repositories.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const repos = await prisma.repository.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { name: true } },
          _count: { select: { issues: true } }
        }
      });
      return json(repos);
    }
  },
  {
    name: 'create_repository',
    description: 'Create a new repository record inside the Fluxion Core database.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the repository' },
        url: { type: 'string', description: 'The URL of the repository (e.g. GitHub URL)' },
        productId: { type: 'string', description: 'Optional UUID of the product this repository belongs to' }
      },
      required: ['name']
    },
    handler: async (args) => {
      if (!args?.name) throw new Error('Missing name');
      const r = await prisma.repository.create({
        data: {
          name: args.name,
          url: args.url || null,
          productId: args.productId || null
        }
      });
      revalidate('/');
      return text(`Successfully created repository ${r.name}`);
    }
  },
  {
    name: 'assign_issue_details',
    description: 'Assign an issue to a product, project, and/or repository.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The UUID of the issue' },
        productId: { type: 'string', description: 'The UUID of the product, or "none" / null to unassign' },
        projectId: { type: 'string', description: 'The UUID of the project, or "none" / null to unassign' },
        repoId: { type: 'string', description: 'The UUID of the repository, or "none" / null to unassign' }
      },
      required: ['issueId']
    },
    handler: async (args) => {
      if (!args?.issueId) throw new Error('Missing issueId');

      const updateData: Record<string, string | null> = {};
      if (args.productId !== undefined) {
        updateData.productId = args.productId === 'none' || args.productId === '' ? null : args.productId;
      }
      if (args.projectId !== undefined) {
        updateData.projectId = args.projectId === 'none' || args.projectId === '' ? null : args.projectId;
      }
      if (args.repoId !== undefined) {
        updateData.repoId = args.repoId === 'none' || args.repoId === '' ? null : args.repoId;
      }

      const updated = await prisma.issue.update({
        where: { id: args.issueId },
        data: updateData
      });
      revalidate('/');
      return text(`Successfully updated issue ${updated.identifier} mappings.`);
    }
  },
  {
    name: 'read_document',
    description: 'Read a technical document or architecture wiki article from the Documentation Hub.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The unique URL slug of the document' }
      },
      required: ['slug']
    },
    handler: async (args) => {
      if (!args?.slug) throw new Error('Missing slug');
      const doc = await prisma.document.findUnique({
        where: { slug: args.slug },
        include: { product: true, repo: true, project: true }
      });
      if (!doc) {
        return { content: [{ type: 'text', text: `Document with slug ${args.slug} not found.` }], isError: true };
      }
      return json(doc);
    }
  },
  {
    name: 'write_document',
    description: 'Create or update a technical document or architecture wiki article in the Documentation Hub.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The title of the document' },
        content: { type: 'string', description: 'Markdown formatted content of the document' },
        category: { type: 'string', description: 'Category (Architecture, Schema, API, Guides, General)' },
        productId: { type: 'string', description: 'Optional UUID of the associated Product' },
        repoId: { type: 'string', description: 'Optional UUID of the associated Repository' },
        projectId: { type: 'string', description: 'Optional UUID of the associated Project' }
      },
      required: ['title', 'content']
    },
    handler: async (args) => {
      if (!args?.title || !args?.content) throw new Error('Missing title or content');

      let slug = args.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
      const existing = await prisma.document.findUnique({ where: { slug } });
      if (existing) {
        slug = `${slug}-${Math.floor(Math.random() * 1000)}`;
      }

      const doc = await prisma.document.create({
        data: {
          title: args.title,
          slug,
          content: args.content,
          category: args.category || 'General',
          productId: args.productId || null,
          repoId: args.repoId || null,
          projectId: args.projectId || null
        }
      });
      revalidate('/docs');
      return text(`Successfully published document ${doc.title} at slug: ${doc.slug}`);
    }
  },
  {
    name: 'create_change_log',
    description: 'Create a new Change Control audit log (e.g. database migration, release version deploy).',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Deployment, Migration, API Release, Config Change' },
        description: { type: 'string', description: 'Detailed description of the change' },
        reason: { type: 'string', description: 'Why this change was made / rationale' },
        approvedBy: { type: 'string', description: 'Name of the human approver (e.g., George Loudon)' },
        implementedBy: { type: 'string', description: 'Name of the runner (e.g., Antigravity or George Loudon)' },
        productId: { type: 'string', description: 'Optional UUID of the Product scope' },
        repoId: { type: 'string', description: 'Optional UUID of the Repository scope' },
        issueId: { type: 'string', description: 'Optional UUID of the associated Issue' }
      },
      required: ['type', 'description', 'approvedBy', 'implementedBy']
    },
    handler: async (args) => {
      if (!args?.type || !args?.description || !args?.approvedBy || !args?.implementedBy) {
        throw new Error('Missing required change_log fields');
      }
      const log = await prisma.changeLog.create({
        data: {
          type: args.type,
          description: args.description,
          reason: args.reason || null,
          approvedBy: args.approvedBy,
          implementedBy: args.implementedBy,
          productId: args.productId || null,
          repoId: args.repoId || null,
          issueId: args.issueId || null
        }
      });
      revalidate('/change-control');
      return text(`Successfully registered Change Control audit log ID ${log.id} for type: ${log.type}.`);
    }
  },
  {
    name: 'query_telemetry',
    description: 'Query live operations telemetry status: environments, active builds, and activities.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by type: builds, environments, activities' }
      }
    },
    handler: async (args) => {
      const type = args?.type;
      const results: Record<string, unknown> = {};
      if (!type || type === 'environments') {
        results.environments = await prisma.environment.findMany({ orderBy: { name: 'asc' } });
      }
      if (!type || type === 'builds') {
        results.builds = await prisma.build.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { repo: true } });
      }
      if (!type || type === 'activities') {
        results.activities = await prisma.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
      }
      return json(results);
    }
  }
];

export function listToolSchemas() {
  return mcpTools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export async function callTool(name: string, args: unknown): Promise<ToolResult> {
  const tool = mcpTools.find(t => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool.handler(args ?? {});
}
