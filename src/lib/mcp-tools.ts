import { prisma } from './prisma';
import { Prisma } from '@prisma/client';
import { createNamespacedIssue, assertAllowedTransition, assertNoParentCycle, allowedNextStatuses, isValidStatus, VALID_STATUSES, CLOSED_STATUSES } from './issues';
import { getChecklist, parseCriteria } from './fionn/gatekeeper';
import { computeProductMetrics } from './metrics';
import { multiIndexSearch } from './search';
import { upsertDocument } from './documents';
import { isValidProductStatus, VALID_PRODUCT_STATUSES, assertValidProductTransition } from './products';
import { isValidProjectStatus, mintProjectSlug, allowedNextProjectStatuses } from './projects';
import { hydrateIssueContext } from './fionn/hydrator';
import { parsePcpPacket, verifyFingerprint, refingerprintPacket, serializePacketFile, renderPcpBriefing } from './pcp';
import { updateRepository, archiveRepository } from './repositories';
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

// Per-call context threaded from the transports (FLX-133). `identity` is the
// key-derived `<AgentName>@<hostname>` token when the caller authenticated
// with a per-agent key; undefined for the legacy shared FLUXION_API_KEY.
export interface ToolContext {
  identity?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: any, ctx: ToolContext) => Promise<ToolResult>;
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

// Enforced attribution (FLX-133). When the caller authenticated with a
// per-agent key, the key-derived identity is authoritative: a client value
// must match it (exact, or prefixed like "Claude@host (autonomous)") or the
// call is refused — impersonation is a hard error, not a warning. Legacy
// shared-key callers keep the old trusted-client behavior.
function stampedActor(clientValue: unknown, ctx: ToolContext, field: string): string | undefined {
  const supplied = typeof clientValue === 'string' && clientValue.trim() ? clientValue.trim() : undefined;
  if (!ctx.identity) return supplied;
  if (supplied && supplied !== ctx.identity && !supplied.startsWith(`${ctx.identity} `)) {
    throw new Error(`${field} "${supplied}" does not match your key-derived identity "${ctx.identity}". Omit ${field} (it is stamped from your API key) or pass your own identity — impersonation is refused.`);
  }
  return supplied ?? ctx.identity;
}

// Closes the actor gap on tools that carry no attribution field: when the
// caller has a key-derived identity, mutations leave an audit trail entry.
// Legacy shared-key callers produce no entry (pre-FLX-133 behavior).
async function logActor(ctx: ToolContext, action: string, target: string) {
  if (!ctx.identity) return;
  await prisma.activityLog.create({
    data: { actor: ctx.identity, actorIcon: 'bot', action, target },
  });
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

// Resolves a cycle by UUID or slug.
async function resolveCycle(args: { cycleId?: string; cycleSlug?: string }) {
  if (args.cycleId) {
    return prisma.cycle.findUnique({ where: { id: args.cycleId } });
  }
  if (args.cycleSlug) {
    return prisma.cycle.findUnique({ where: { slug: args.cycleSlug.toLowerCase().trim() } });
  }
  return null;
}

// Resolves a project by UUID or slug.
async function resolveProject(args: { projectId?: string; projectSlug?: string; slug?: string }) {
  if (args.projectId) {
    return prisma.project.findUnique({ where: { id: args.projectId } });
  }
  const slug = args.projectSlug || args.slug;
  if (slug) {
    return prisma.project.findUnique({ where: { slug: slug.trim() } });
  }
  return null;
}

export const mcpTools: ToolDef[] = [
  {
    name: 'read_issues',
    description: 'List issues in the Fluxion Core database. Returns issues of ALL statuses by default — pass openOnly to exclude closed issues (Done, Cancelled), status for one exact status, and productId/productSlug to scope to a single product. Returns summary fields per issue; pass verbose for the full agent-contract bodies, or use read_issue for one issue\'s detail.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: `Filter by exact status (${VALID_STATUSES.join(', ')})` },
        openOnly: { type: 'boolean', description: `Exclude closed issues (${CLOSED_STATUSES.join(', ')})` },
        productId: { type: 'string', description: 'Scope to the product with this UUID' },
        productSlug: { type: 'string', description: 'Scope to the product with this slug (e.g. FLX), as an alternative to productId' },
        verbose: { type: 'boolean', description: 'Include the full agent-contract bodies (description, context, acceptanceCriteria, technicalIntent) — large; prefer the default summary when listing' }
      }
    },
    handler: async (args) => {
      const where: Prisma.IssueWhereInput = {};
      if (args?.status) {
        if (!isValidStatus(args.status)) {
          throw new Error(`Invalid status "${args.status}". Valid statuses: ${VALID_STATUSES.join(', ')}`);
        }
        if (args.openOnly && (CLOSED_STATUSES as readonly string[]).includes(args.status)) {
          throw new Error(`status "${args.status}" is a closed status — it contradicts openOnly. Drop openOnly or pick an open status.`);
        }
        where.status = args.status;
      } else if (args?.openOnly) {
        where.status = { notIn: [...CLOSED_STATUSES] };
      }
      if (args?.productId || args?.productSlug) {
        const product = await resolveProduct(args);
        if (!product) throw new Error(`Product not found: "${args.productId ?? args.productSlug}" — provide a valid productId or productSlug`);
        where.productId = product.id;
      }
      const issues = await prisma.issue.findMany({
        where,
        select: {
          id: true,
          identifier: true,
          title: true,
          status: true,
          priority: true,
          createdAt: true,
          updatedAt: true,
          product: { select: { slug: true } },
          parent: { select: { identifier: true } },
          _count: { select: { children: true } },
          ...(args?.verbose ? { description: true, context: true, acceptanceCriteria: true, technicalIntent: true } : {})
        }
      });
      return json(issues);
    }
  },
  {
    name: 'check_criterion',
    description: 'Fionn Verification Gatekeeper: attest one checkbox acceptance criterion of an issue with evidence (the command you ran, the output you observed). All checkbox criteria must be attested before the issue can transition to Done. Fluxion records the evidence; it never executes verification itself. Attestations are audit-logged and invalidated automatically if the criterion text is edited.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The UUID of the issue' },
        identifier: { type: 'string', description: 'The human identifier (e.g. FLX-123), as an alternative to issueId' },
        criterionIndex: { type: 'number', description: 'Zero-based index of the checkbox criterion (as listed by read_issue.checklist)' },
        evidence: { type: 'string', description: 'Verifiable evidence: what was run/checked and what was observed' },
        attestor: { type: 'string', description: 'Who attests (default "agent")' }
      },
      required: ['evidence']
    },
    handler: async (args, ctx) => {
      const issue = await resolveIssue(args ?? {});
      if (!issue) throw new Error('Issue not found: provide a valid issueId or identifier');
      if (typeof args.criterionIndex !== 'number') throw new Error('Missing criterionIndex');
      if (!args.evidence || typeof args.evidence !== 'string' || !args.evidence.trim()) {
        throw new Error('Evidence is required: state what was run/checked and what was observed');
      }
      const criteria = parseCriteria(issue.acceptanceCriteria);
      if (criteria.length === 0) throw new Error(`${issue.identifier} has no checkbox acceptance criteria to attest`);
      const criterion = criteria[args.criterionIndex];
      if (!criterion) {
        throw new Error(`No criterion at index ${args.criterionIndex}. Checklist: ${criteria.map(c => `[${c.index}] ${c.text}`).join(' | ')}`);
      }
      const attestor = stampedActor(args.attestor, ctx, 'attestor') ?? 'agent';

      await prisma.criterionAttestation.upsert({
        where: { issueId_criterionHash: { issueId: issue.id, criterionHash: criterion.hash } },
        update: { evidence: args.evidence.trim(), attestor },
        create: {
          issueId: issue.id,
          criterionHash: criterion.hash,
          criterion: criterion.text,
          evidence: args.evidence.trim(),
          attestor,
        },
      });
      await prisma.activityLog.create({
        data: {
          actor: attestor,
          actorIcon: 'bot',
          action: `Attested criterion [${criterion.index}] of ${issue.identifier}: "${criterion.text}" — ${args.evidence.trim().slice(0, 140)}`,
          target: issue.identifier,
        },
      });

      const checklist = await getChecklist(prisma, issue);
      const open = checklist.filter(c => !c.attested);
      revalidate('/');
      return text(`Attested [${criterion.index}] "${criterion.text}" on ${issue.identifier}. ${open.length === 0 ? 'All criteria attested — Done transition is unlocked.' : `${open.length} criteria remain: ${open.map(c => `[${c.index}] ${c.text}`).join(' | ')}`}`);
    }
  },
  {
    name: 'decompose_issue',
    description: 'Fionn Goal Tree: atomically decompose a parent issue into child issues in one validated transaction (all-or-nothing). Children inherit the parent\'s product namespace and project by default. Agents declare their decomposition explicitly here instead of creating disconnected flat backlogs.',
    inputSchema: {
      type: 'object',
      properties: {
        parentIdentifier: { type: 'string', description: 'Identifier of the parent issue (e.g. FLX-102)' },
        children: {
          type: 'array',
          description: 'The child issues to create (1-20)',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Child issue title' },
              description: { type: 'string', description: 'Child description' },
              context: { type: 'string', description: 'Agent contract: context' },
              acceptanceCriteria: { type: 'string', description: 'Agent contract: verifiable Done conditions' },
              technicalIntent: { type: 'string', description: 'Agent contract: approach/constraints' },
              priority: { type: 'string', description: 'Low, Medium, High, Critical (default Medium)' },
              status: { type: 'string', description: 'Initial status (default Todo)' }
            },
            required: ['title']
          }
        }
      },
      required: ['parentIdentifier', 'children']
    },
    handler: async (args) => {
      if (!args?.parentIdentifier) throw new Error('Missing parentIdentifier');
      if (!Array.isArray(args.children) || args.children.length === 0) throw new Error('children must be a non-empty array');
      if (args.children.length > 20) throw new Error('Decompose into at most 20 children per call');
      for (const [i, c] of args.children.entries()) {
        if (!c?.title || typeof c.title !== 'string') throw new Error(`children[${i}] is missing a title`);
      }
      const parent = await prisma.issue.findUnique({ where: { identifier: args.parentIdentifier.toUpperCase().trim() } });
      if (!parent) throw new Error(`Parent issue not found for identifier: ${args.parentIdentifier}`);

      const created = await prisma.$transaction(async (tx) => {
        const out = [];
        for (const c of args.children) {
          out.push(await createNamespacedIssue({
            title: c.title,
            description: c.description,
            context: c.context,
            acceptanceCriteria: c.acceptanceCriteria,
            technicalIntent: c.technicalIntent,
            priority: c.priority,
            status: c.status,
            parentId: parent.id,
            productId: parent.productId,
            projectId: parent.projectId,
          }, tx));
        }
        return out;
      });

      revalidate('/');
      return text(`Decomposed ${parent.identifier} into ${created.length} children: ${created.map(c => c.identifier).join(', ')}`);
    }
  },
  {
    name: 'hydrate_issue_context',
    description: 'Fionn Context Hydrator: returns one deterministic markdown Context Package for an issue — product vision, product boundaries (scope guard), parent objective, the full issue contract, linked repositories, and legal next statuses. Call this before executing a task; the package is designed to be injected directly into an agent prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The UUID of the issue' },
        identifier: { type: 'string', description: 'The human identifier (e.g. FLX-122), as an alternative to issueId' }
      }
    },
    handler: async (args) => {
      const pkg = await hydrateIssueContext(args ?? {});
      return text(pkg);
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
      const checklist = await getChecklist(prisma, issue!);
      return json({
        ...issue,
        checklist: checklist.map(c => ({ index: c.index, text: c.text, attested: c.attested, attestor: c.attestor, evidence: c.evidence })),
        allowedNextStatuses: allowedNextStatuses(issue!.status)
      });
    }
  },
  {
    name: 'read_governing_context',
    description: 'Read the governing context for an issue: the active Decision/Config-Change change logs scoped to the issue, its project, or its product, plus the product\'s durable Boundaries and Architecture briefs. Intended for boundary/policy-aware verification — judging whether an issue\'s criteria are consistent with current policy and cover the product boundaries, not just whether evidence supports the criteria as written.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The UUID of the issue' },
        identifier: { type: 'string', description: 'The human identifier (e.g. AETHERMUX-5), as an alternative to issueId' }
      }
    },
    handler: async (args) => {
      const resolved = await resolveIssue(args ?? {});
      if (!resolved) throw new Error('Issue not found: provide a valid issueId or identifier');
      const issue = await prisma.issue.findUnique({
        where: { id: resolved.id },
        select: { id: true, identifier: true, productId: true, projectId: true }
      });
      const scope: Prisma.ChangeLogWhereInput[] = [{ issueId: issue!.id }];
      if (issue!.projectId) scope.push({ projectId: issue!.projectId });
      if (issue!.productId) scope.push({ productId: issue!.productId });
      const decisions = await prisma.changeLog.findMany({
        where: { type: { in: ['Decision', 'Config Change'] }, OR: scope },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { type: true, description: true, reason: true, createdAt: true }
      });
      const briefs = issue!.productId
        ? await prisma.document.findMany({
            where: { productId: issue!.productId, docType: { in: ['Boundaries', 'Architecture'] } },
            select: { docType: true, title: true, content: true }
          })
        : [];
      return json({ issue: issue!.identifier, decisions, briefs });
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
    handler: async (args, ctx) => {
      if (!args?.issueId || !args?.status) throw new Error('Missing args');
      const issue = await prisma.issue.findUnique({ where: { id: args.issueId } });
      if (!issue) throw new Error(`Issue not found for id: ${args.issueId}`);
      await assertAllowedTransition(prisma, issue, args.status);
      const updated = await prisma.issue.update({
        where: { id: args.issueId },
        data: { status: args.status }
      });
      await logActor(ctx, `Updated status of ${updated.identifier}: ${issue.status} -> ${updated.status}`, updated.identifier);
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
    handler: async (args, ctx) => {
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
        await assertAllowedTransition(prisma, issue, args.status.trim());
        data.status = args.status.trim();
      }
      if (typeof args.parentIdentifier === 'string' && args.parentIdentifier.trim()) {
        const ref = args.parentIdentifier.trim();
        if (ref.toLowerCase() === 'none') {
          data.parentId = null;
        } else {
          const parent = await prisma.issue.findUnique({ where: { identifier: ref.toUpperCase() } });
          if (!parent) throw new Error(`Parent issue not found for identifier: ${ref}`);
          await assertNoParentCycle(prisma, issue.id, parent.id);
          data.parentId = parent.id;
        }
      }
      if (Object.keys(data).length === 0) {
        throw new Error('No updatable fields provided (title, description, priority, status, context, acceptanceCriteria, technicalIntent, parentIdentifier)');
      }

      const updated = await prisma.issue.update({ where: { id: issue.id }, data });
      await logActor(ctx, `Updated issue ${updated.identifier} (${Object.keys(data).join(', ')})`, updated.identifier);
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
    handler: async (args, ctx) => {
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
      await logActor(ctx, `Created issue ${newIssue.identifier}: ${newIssue.title}`, newIssue.identifier);
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
    name: 'read_cycle',
    description: 'Read a development cycle in full, including its issues, documents, and derived metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        cycleId: { type: 'string', description: 'The UUID of the cycle' },
        cycleSlug: { type: 'string', description: 'The slug of the cycle (e.g. sprint-24), as an alternative to cycleId' }
      }
    },
    handler: async (args) => {
      const cycle = await resolveCycle(args);
      if (!cycle) throw new Error('Cycle not found: provide a valid cycleId or cycleSlug');

      const fullCycle = await prisma.cycle.findUnique({
        where: { id: cycle.id },
        include: {
          issues: {
            orderBy: { identifier: 'asc' },
            select: {
              id: true,
              identifier: true,
              title: true,
              status: true,
              priority: true,
              productId: true,
              product: { select: { slug: true } },
              projectId: true,
              project: { select: { slug: true } },
              parentId: true,
              parent: { select: { identifier: true } }
            }
          },
          documents: {
            orderBy: { updatedAt: 'desc' },
            select: {
              id: true,
              title: true,
              slug: true,
              docType: true,
              updatedAt: true
            }
          }
        }
      });
      return json(fullCycle);
    }
  },
  {
    name: 'create_cycle',
    description: 'Create a new development cycle/sprint inside the Fluxion Core database.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the cycle (e.g. Sprint 24)' },
        startDate: { type: 'string', description: 'Start date in ISO-8601 format (YYYY-MM-DD)' },
        endDate: { type: 'string', description: 'End date in ISO-8601 format (YYYY-MM-DD)' },
        goal: { type: 'string', description: 'The 1-2 sentence operational win goal for this cycle' },
        capacityPoints: { type: 'number', description: 'Projected point capacity velocity for this cycle' },
        status: { type: 'string', description: 'Initial status of the cycle (Planned, Active, Completed; default Planned)' }
      },
      required: ['name', 'startDate', 'endDate']
    },
    handler: async (args) => {
      if (!args?.name || !args?.startDate || !args?.endDate) {
        throw new Error('Missing required fields: name, startDate, endDate');
      }
      const status = args.status || 'Planned';
      const { isValidCycleStatus, mintCycleSlug, VALID_CYCLE_STATUSES } = await import('./cycles');
      if (!isValidCycleStatus(status)) {
        throw new Error(`Invalid status "${status}". Valid statuses: ${VALID_CYCLE_STATUSES.join(', ')}`);
      }

      if (status === 'Active') {
        const conflict = await prisma.cycle.findFirst({ where: { status: 'Active' } });
        if (conflict) {
          throw new Error(`Cannot create cycle in Active status: "${conflict.name}" is already Active. Complete it first.`);
        }
      }

      let slug = mintCycleSlug(args.name);
      if (await prisma.cycle.findUnique({ where: { slug } })) {
        slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
      }

      const c = await prisma.cycle.create({
        data: {
          name: args.name,
          slug,
          startDate: new Date(args.startDate),
          endDate: new Date(args.endDate),
          goal: args.goal || null,
          capacityPoints: typeof args.capacityPoints === 'number' ? args.capacityPoints : null,
          status
        }
      });
      revalidate('/', '/cycles');
      return text(`Successfully created cycle ${c.name} with slug ${c.slug} (${c.status})`);
    }
  },
  {
    name: 'update_cycle_status',
    description: 'Update the lifecycle status of a specific development cycle (Planned, Active, Completed). Enforces that at most one cycle is Active at a time.',
    inputSchema: {
      type: 'object',
      properties: {
        cycleId: { type: 'string', description: 'The UUID of the cycle' },
        cycleSlug: { type: 'string', description: 'The slug of the cycle (e.g. sprint-24), as an alternative to cycleId' },
        status: { type: 'string', description: 'The next status (Planned, Active, Completed)' }
      },
      required: ['status']
    },
    handler: async (args) => {
      if (!args?.status) throw new Error('Missing status');
      const cycle = await resolveCycle(args);
      if (!cycle) throw new Error('Cycle not found: provide a valid cycleId or cycleSlug');

      const { assertValidCycleTransition } = await import('./cycles');
      assertValidCycleTransition(cycle.status, args.status);

      if (args.status === 'Active') {
        const conflict = await prisma.cycle.findFirst({
          where: { status: 'Active', id: { not: cycle.id } }
        });
        if (conflict) {
          throw new Error(`Cannot activate "${cycle.name}": cycle "${conflict.name}" is already Active. Complete it first.`);
        }
      }

      const updated = await prisma.cycle.update({
        where: { id: cycle.id },
        data: { status: args.status }
      });

      revalidate('/', '/cycles');
      if (updated.slug) revalidate(`/cycles/${updated.slug}`);
      return text(`Successfully updated cycle ${updated.name} status to ${updated.status}`);
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
    name: 'read_product_briefs',
    description: 'Read the durable scope-guard briefs (Vision and Boundaries documents) for every product, or one product by slug. Deterministic read-side assembly for governance hydration (Fionn conversion, FLX-144): each entry carries slug, name, status, description, and the brief contents (null when not documented).',
    inputSchema: {
      type: 'object',
      properties: {
        productSlug: { type: 'string', description: 'Optional product slug to fetch a single product\'s briefs' }
      }
    },
    handler: async (args) => {
      const products = await prisma.product.findMany({
        where: args?.productSlug ? { slug: String(args.productSlug).toUpperCase() } : undefined,
        orderBy: { createdAt: 'asc' },
        include: {
          documents: { where: { docType: { in: ['Vision', 'Boundaries'] } }, select: { docType: true, content: true } }
        }
      });
      if (args?.productSlug && products.length === 0) {
        throw new Error(`Product not found: ${args.productSlug}`);
      }
      return json(products.map(p => ({
        slug: p.slug,
        name: p.name,
        status: p.status,
        description: p.description,
        vision: p.documents.find(d => d.docType === 'Vision')?.content ?? null,
        boundaries: p.documents.find(d => d.docType === 'Boundaries')?.content ?? null
      })));
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
    description: 'Create a new product inside the Fluxion Core database. Lifecycle statuses: Concept, Active, Maintenance, Sunset, Archived (default Active; use Concept for ideas not yet in development).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the product' },
        description: { type: 'string', description: 'Detailed description of the product' },
        status: { type: 'string', description: 'Initial lifecycle status (default Active; Concept for pre-development ideas)' }
      },
      required: ['name']
    },
    handler: async (args) => {
      if (!args?.name) throw new Error('Missing name');
      const status = args.status || 'Active';
      if (!isValidProductStatus(status)) {
        throw new Error(`Invalid product status "${status}". Valid statuses: ${VALID_PRODUCT_STATUSES.join(', ')}`);
      }

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
          status
        }
      });
      revalidate('/', '/products');
      return text(`Successfully created product ${p.name} with slug ${p.slug} (${p.status})`);
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
    name: 'update_product_status',
    description: 'Update the lifecycle status of a specific product (Concept, Active, Maintenance, Sunset, Archived). Transitions are validated against the product lifecycle graph; an illegal transition is rejected with the allowed next states named. Archiving through this tool is the same soft-delete as archive_product (history preserved, no destructive path).',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'The UUID of the product' },
        productSlug: { type: 'string', description: 'The product slug (e.g. FIONN-AI), as an alternative to productId' },
        status: { type: 'string', description: 'The next status (Concept, Active, Maintenance, Sunset, Archived)' }
      },
      required: ['status']
    },
    handler: async (args) => {
      if (!args?.status) throw new Error('Missing status');
      const product = await resolveProduct(args ?? {});
      if (!product) throw new Error('Product not found: provide a valid productId or productSlug');

      assertValidProductTransition(product.status, args.status);
      if (product.status === args.status) {
        return text(`Product ${product.name} (${product.slug}) is already ${product.status} — nothing to change`);
      }

      const updated = await prisma.product.update({
        where: { id: product.id },
        data: { status: args.status }
      });

      revalidate('/', '/products');
      return text(`Successfully updated product ${updated.name} (${updated.slug}) status to ${updated.status}`);
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
    description: 'Create a new project (fixed-term execution container under a product) inside the Fluxion Core database. Lifecycle statuses: Planned, Active, On Hold, Completed, Cancelled.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the project' },
        description: { type: 'string', description: 'Detailed description of the project' },
        productId: { type: 'string', description: 'Optional UUID of the product this project belongs to' },
        status: { type: 'string', description: 'Initial status (default Planned)' }
      },
      required: ['name']
    },
    handler: async (args) => {
      if (!args?.name) throw new Error('Missing name');
      const status = args.status || 'Planned';
      if (!isValidProjectStatus(status)) {
        throw new Error(`Invalid project status "${status}". Valid: Planned, Active, On Hold, Completed, Cancelled`);
      }
      let slug = mintProjectSlug(args.name);
      if (await prisma.project.findUnique({ where: { slug } })) {
        slug = `${slug}-${Math.floor(Math.random() * 10000).toString(36)}`;
      }
      const proj = await prisma.project.create({
        data: {
          name: args.name,
          slug,
          description: args.description || null,
          status,
          productId: args.productId || null
        }
      });
      revalidate('/', '/projects');
      return text(`Successfully created project ${proj.name} (slug ${proj.slug}, ${proj.status})`);
    }
  },
  {
    name: 'read_project',
    description: 'Read one project in full: lifecycle status and legal transitions, dates, product, durable-doc coverage (Charter, Design, Risk, Retrospective), a derived status report (issues by status, completion, open blockers), its issues, and recent project-scoped change logs.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The project slug (e.g. fionn-cognitive-command-layer)' },
        projectId: { type: 'string', description: 'The UUID of the project, as an alternative to slug' }
      }
    },
    handler: async (args) => {
      const project = args?.projectId
        ? await prisma.project.findUnique({ where: { id: args.projectId } })
        : args?.slug
          ? await prisma.project.findUnique({ where: { slug: args.slug } })
          : null;
      if (!project) throw new Error('Project not found: provide a valid slug or projectId');
      const full = await prisma.project.findUnique({
        where: { id: project.id },
        include: {
          product: { select: { slug: true, name: true } },
          issues: { select: { identifier: true, title: true, status: true, priority: true, parent: { select: { identifier: true } } }, orderBy: { identifier: 'asc' } },
          documents: { select: { slug: true, title: true, docType: true, updatedAt: true } },
          changeLogs: { orderBy: { createdAt: 'desc' }, take: 10, select: { type: true, description: true, approvedBy: true, createdAt: true } },
        }
      });
      const issues = full!.issues;
      const done = issues.filter(i => i.status === 'Done').length;
      const statusReport = {
        totalIssues: issues.length,
        byStatus: issues.reduce((acc: Record<string, number>, i) => { acc[i.status] = (acc[i.status] ?? 0) + 1; return acc; }, {}),
        completionPct: issues.length ? Math.round((done / issues.length) * 100) : 0,
        openBlockers: issues.filter(i => i.status !== 'Done' && i.status !== 'Cancelled' && (i.priority === 'High' || i.priority === 'Critical')).map(i => i.identifier),
      };
      return json({ ...full, statusReport, allowedNextStatuses: allowedNextProjectStatuses(full!.status) });
    }
  },
  {
    name: 'update_project_status',
    description: 'Update the lifecycle status of a specific project (Planned, Active, On Hold, Completed, Cancelled). Enforces transition validation and required durable documents/completed work rules.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The UUID of the project' },
        projectSlug: { type: 'string', description: 'The project slug (e.g. context-grounded-mission-packet-workflow), as an alternative to projectId' },
        slug: { type: 'string', description: 'The project slug (e.g. context-grounded-mission-packet-workflow), as an alternative to projectId' },
        status: { type: 'string', description: 'The next status (Planned, Active, On Hold, Completed, Cancelled)' }
      },
      required: ['status']
    },
    handler: async (args) => {
      if (!args?.status) throw new Error('Missing status');
      const project = await resolveProject(args);
      if (!project) throw new Error('Project not found: provide a valid projectId, projectSlug or slug');

      const { assertValidProjectTransition } = await import('./projects');
      assertValidProjectTransition(project.status, args.status);

      const { checkProjectClosureAndDurableDocs } = await import('../actions/projects');
      await checkProjectClosureAndDurableDocs(project.id, args.status);

      const updated = await prisma.project.update({
        where: { id: project.id },
        data: { status: args.status }
      });

      revalidate('/', '/projects');
      if (updated.slug) revalidate(`/projects/${updated.slug}`);

      return text(`Successfully updated project ${updated.name} status to ${updated.status}`);
    }
  },
  {
    name: 'read_repositories',
    description: 'Read the list of codebase repositories. Archived (soft-deleted) records are excluded unless includeArchived is true.',
    inputSchema: {
      type: 'object',
      properties: {
        includeArchived: { type: 'boolean', description: 'Include archived repositories (default false)' }
      }
    },
    handler: async (args) => {
      const repos = await prisma.repository.findMany({
        where: args?.includeArchived ? undefined : { archivedAt: null },
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
    name: 'archive_repository',
    description: 'Archive (soft-delete) a repository record, or restore it with restore=true. Idempotent; archived records keep all linked history (issues, commits, change logs) and are excluded from listings by default. There is no destructive delete. Webhook signals naming an archived repo still match it (no duplicate is created) but never unarchive it.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', description: 'The UUID of the repository' },
        repoName: { type: 'string', description: 'The repository name (must match exactly one record), as an alternative to repoId' },
        restore: { type: 'boolean', description: 'Restore an archived repository instead of archiving (default false)' }
      }
    },
    handler: async (args) => {
      const { repo, already } = await archiveRepository({ repoId: args?.repoId, repoName: args?.repoName }, args?.restore === true);
      revalidate('/repositories');
      if (args?.restore === true) {
        return text(already ? `Repository ${repo.name} is not archived — nothing to restore` : `Successfully restored repository ${repo.name}`);
      }
      return text(already ? `Repository ${repo.name} is already archived` : `Successfully archived repository ${repo.name} (history preserved; restore with restore=true)`);
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
        include: { product: true, repo: true, project: true, cycle: true }
      });
      if (!doc) {
        return { content: [{ type: 'text', text: `Document with slug ${args.slug} not found.` }], isError: true };
      }
      return json(doc);
    }
  },
  {
    name: 'write_document',
    description: 'Create or update a technical document in the Documentation Hub. Upserts by slug: writing to an existing slug updates the document and snapshots its prior state into revision history. docType marks the durable product-doc slots (Vision, Boundaries, Architecture); keep those concise — scope-guard briefs, not theses. Full documentation belongs in the linked repository.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The title of the document' },
        content: { type: 'string', description: 'Markdown formatted content of the document' },
        slug: { type: 'string', description: 'Optional explicit slug; defaults to a slugified title. Writing to an existing slug updates that document (with a revision snapshot).' },
        category: { type: 'string', description: 'Category (Architecture, Schema, API, Guides, General)' },
        docType: { type: 'string', description: 'Durable-doc slot: Vision, Boundaries, Architecture, or General (default)' },
        productId: { type: 'string', description: 'Optional UUID of the associated Product' },
        repoId: { type: 'string', description: 'Optional UUID of the associated Repository' },
        projectId: { type: 'string', description: 'Optional UUID of the associated Project' },
        cycleId: { type: 'string', description: 'Optional UUID of the associated Cycle (for CyclePlan/CycleReview docs)' }
      },
      required: ['title', 'content']
    },
    handler: async (args) => {
      const { document: doc, created } = await upsertDocument({
        title: args?.title,
        content: args?.content,
        slug: args?.slug,
        category: args?.category,
        docType: args?.docType,
        productId: args?.productId,
        repoId: args?.repoId,
        projectId: args?.projectId,
        cycleId: args?.cycleId
      });
      revalidate('/docs');
      return text(`Successfully ${created ? 'published' : 'updated'} document ${doc.title} at slug: ${doc.slug}${created ? '' : ' (previous version saved to revision history)'}`);
    }
  },
  {
    name: 'create_change_log',
    description: 'Create a new Change Control audit log. Types include Deployment, Migration, API Release, Config Change — and "Decision" for project decision-log entries (scope with projectId).',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Deployment, Migration, API Release, Config Change, Decision' },
        description: { type: 'string', description: 'Detailed description of the change' },
        reason: { type: 'string', description: 'Why this change was made / rationale' },
        approvedBy: { type: 'string', description: 'Name of the human approver (e.g., George Loudon)' },
        implementedBy: { type: 'string', description: 'Name of the runner. Callers on a per-agent API key may omit this — it is stamped from the key-derived identity, and a mismatching value is refused.' },
        productId: { type: 'string', description: 'Optional UUID of the Product scope' },
        repoId: { type: 'string', description: 'Optional UUID of the Repository scope' },
        issueId: { type: 'string', description: 'Optional UUID of the associated Issue' },
        projectId: { type: 'string', description: 'Optional UUID of the Project scope (use with type "Decision" for project decision logs)' }
      },
      required: ['type', 'description', 'approvedBy']
    },
    handler: async (args, ctx) => {
      if (!args?.type || !args?.description || !args?.approvedBy) {
        throw new Error('Missing required change_log fields');
      }
      const implementedBy = stampedActor(args.implementedBy, ctx, 'implementedBy');
      if (!implementedBy) {
        throw new Error('Missing implementedBy (required for legacy shared-key callers; per-agent keys stamp it automatically)');
      }
      const log = await prisma.changeLog.create({
        data: {
          type: args.type,
          description: args.description,
          reason: args.reason || null,
          approvedBy: args.approvedBy,
          implementedBy,
          productId: args.productId || null,
          repoId: args.repoId || null,
          issueId: args.issueId || null,
          projectId: args.projectId || null
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
  },
  {
    name: 'update_repository',
    description: 'Update a repository record: name, url, or product assignment (records are registered in stages, so these legitimately change after creation). Identify by UUID or unambiguous name. Pass "none" as url or productId/productSlug to detach. Consider recording significant changes (re-homing, renames) in change control with repoId scope.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', description: 'The UUID of the repository' },
        repoName: { type: 'string', description: 'The repository name (must match exactly one record), as an alternative to repoId' },
        name: { type: 'string', description: 'New repository name' },
        url: { type: 'string', description: 'New URL (e.g. GitHub URL), or "none" to clear it' },
        productId: { type: 'string', description: 'UUID of the owning product, or "none" to detach' },
        productSlug: { type: 'string', description: 'Product slug (e.g. FLX) as an alternative to productId' }
      }
    },
    handler: async (args) => {
      const { updated, changed } = await updateRepository(
        { repoId: args?.repoId, repoName: args?.repoName },
        { name: args?.name, url: args?.url, productId: args?.productId, productSlug: args?.productSlug },
      );
      revalidate('/repositories');
      return text(`Successfully updated repository ${updated.name} (${changed.join(', ')}) — url: ${updated.url ?? 'none'}, productId: ${updated.productId ?? 'none'}`);
    }
  },
  {
    name: 'read_product_commits',
    description: 'Execution bridge (FLX-119): recent commits routed to a product via ProductRepository pathFilter matching (with repository-default fallback). Use this to scope a code search to the paths a product actually owns before grepping an entire repository.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'The UUID of the product' },
        productSlug: { type: 'string', description: 'Product slug (e.g. FLX) as an alternative to productId' },
        limit: { type: 'number', description: 'Max commits to return (default 20, max 100)' }
      }
    },
    handler: async (args) => {
      const product = await resolveProduct(args ?? {});
      if (!product) throw new Error('Product not found: provide a valid productId or productSlug');
      const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 100);
      const routes = await prisma.commitRoute.findMany({
        where: { productId: product.id },
        orderBy: { commit: { createdAt: 'desc' } },
        take: limit,
        include: { commit: { include: { repo: { select: { name: true, url: true } } } } },
      });
      return json({
        product: { slug: product.slug, name: product.name },
        commits: routes.map((r) => ({
          sha: r.commit.sha,
          message: r.commit.message,
          author: r.commit.author,
          branch: r.commit.branch,
          committedAt: r.commit.committedAt,
          repo: r.commit.repo.name,
          repoUrl: r.commit.repo.url,
          via: r.via,
          matchedPaths: r.matchedPaths,
        })),
      });
    }
  },
  {
    name: 'brief_pcp_packet',
    description: 'PCP Git Branch Handoff (launch stage): validate the raw content of a repository\'s pcp/context.json against the PCP v0.2 packet schema, verify its SHA-256 fingerprint, and return a read-only briefing markdown block to inject into the executing agent\'s prompt. Fluxion never reads repositories itself — the caller reads the file from its own clone and passes the content here.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The raw text content of pcp/context.json, exactly as read from the repository' }
      },
      required: ['content']
    },
    handler: async (args) => {
      if (!args?.content || typeof args.content !== 'string') throw new Error('Missing content: pass the raw text of pcp/context.json');
      const packet = parsePcpPacket(args.content);
      const check = verifyFingerprint(packet);
      if (!check.valid) {
        throw new Error(`PCP fingerprint mismatch: packet declares "${check.found}" but canonical content hashes to "${check.expected}". The packet was edited without re-fingerprinting — refuse the briefing and run refingerprint_pcp_packet (or pcp/tools/validate.py) first.`);
      }
      return text(renderPcpBriefing(packet));
    }
  },
  {
    name: 'refingerprint_pcp_packet',
    description: 'PCP Git Branch Handoff (finalization stage): validate an updated pcp/context.json packet, recompute its SHA-256 fingerprint (and stamp updated_at), and return the exact file content to write back. The caller writes the file into its local clone and commits it to the active feature branch for human PR review — Fluxion never touches the repository.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The updated packet JSON as raw text (fingerprint may be stale; it will be recomputed)' },
        updatedAt: { type: 'string', description: 'ISO 8601 timestamp for updated_at (default: server time now)' }
      },
      required: ['content']
    },
    handler: async (args) => {
      if (!args?.content || typeof args.content !== 'string') throw new Error('Missing content: pass the updated packet JSON as raw text');
      const packet = parsePcpPacket(args.content);
      const updatedAt = (typeof args.updatedAt === 'string' && args.updatedAt.trim()) || new Date().toISOString();
      const next = refingerprintPacket(packet, updatedAt);
      return json({
        fingerprint: next.fingerprint,
        updated_at: next.updated_at,
        instructions: 'Write fileContent verbatim to pcp/context.json in your local clone, then commit it to the active feature branch (never main/master) for PR review.',
        fileContent: serializePacketFile(next),
      });
    }
  }
];

export function listToolSchemas() {
  return mcpTools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export async function callTool(name: string, args: unknown, ctx: ToolContext = {}): Promise<ToolResult> {
  const tool = mcpTools.find(t => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool.handler(args ?? {}, ctx);
}

// --- MCP prompts: operator rituals (the scriptoria curation_triage
// precedent). A prompt is a canned instruction package the operator invokes
// in their own agent session; the session carries it out with the tools it
// has. Both transports serve this registry, like the tool registry above.
interface PromptDef {
  name: string;
  description: string;
  text: string;
}

const mcpPrompts: PromptDef[] = [
  {
    name: 'fionn_conversion_run',
    description: 'Operator ritual (FLX-144): run Fionn\'s conversion governor over the Cortex OS conversion queue — at most 5 entries per run — and review the verdicts conversationally.',
    text: [
      'Run Fionn\'s conversion governor over the Cortex OS library\'s conversion queue (the idea→action seam, doc fionn-seam-idea-to-action).',
      '',
      'From the Fluxion repo root (~/fluxion), run:',
      '',
      '    node --env-file=.env agents/fionn.mjs convert',
      '',
      'The harness runs the full three-phase pipeline per queue entry (batch cap 5): hydrate (queue entry + link neighborhood + prior [conversion] observations + product briefs), judge (one schema-bounded call: convert | decline | defer), enforce & audit (converted issues land in Triage with Change Control attribution; the library record is curated back over POST /curate).',
      '',
      'Then review the verdicts with the operator, one per record: the verdict, its rationale, and — for conversions — the created issue identifier. Everything is reversible: a converted issue can be Cancelled, and the record\'s curation can be re-curated. If the operator wants a preview without any writes first, use `convert --dry-run`.',
      '',
      'Do not judge the queue entries yourself and do not create issues from them directly — conversion judgment belongs exclusively to the harness\'s single bounded model call (Fionn charter).',
    ].join('\n'),
  },
];

export function listPromptSchemas() {
  return mcpPrompts.map(({ name, description }) => ({ name, description }));
}

export function getPrompt(name: string): { description: string; messages: { role: 'user'; content: { type: 'text'; text: string } }[] } {
  const prompt = mcpPrompts.find(p => p.name === name);
  if (!prompt) throw new Error(`Prompt not found: ${name}`);
  return {
    description: prompt.description,
    messages: [{ role: 'user', content: { type: 'text', text: prompt.text } }],
  };
}
