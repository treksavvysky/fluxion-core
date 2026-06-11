import { prisma } from '@/lib/prisma';
import { nextIssueIdentifier } from '@/lib/identifiers';

export const WORKSPACE_SLUG = 'FLX';

// Issue protocol layer (FLX-117). Status lifecycle with an enforced
// transition graph: Triage is the landing state for unvetted work (e.g.
// webhook-born issues); terminal states can be reopened explicitly.
export const VALID_STATUSES = ['Triage', 'Backlog', 'Todo', 'In Progress', 'Done', 'Cancelled'] as const;
export const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

export const STATUS_TRANSITIONS: Record<string, string[]> = {
  'Triage':      ['Backlog', 'Todo', 'In Progress', 'Cancelled'],
  'Backlog':     ['Triage', 'Todo', 'In Progress', 'Cancelled'],
  'Todo':        ['Backlog', 'In Progress', 'Done', 'Cancelled'],
  'In Progress': ['Todo', 'Backlog', 'Done', 'Cancelled'],
  'Done':        ['Todo', 'In Progress'],
  'Cancelled':   ['Triage', 'Backlog', 'Todo'],
};

export function isValidStatus(status: string): boolean {
  return (VALID_STATUSES as readonly string[]).includes(status);
}

export function allowedNextStatuses(from: string): string[] {
  return STATUS_TRANSITIONS[from] ?? [];
}

// Throws with an agent-actionable message when the transition is illegal.
// A same-status "transition" is a no-op and always allowed.
export function assertValidTransition(from: string, to: string): void {
  if (!isValidStatus(to)) {
    throw new Error(`Invalid status "${to}". Valid statuses: ${VALID_STATUSES.join(', ')}`);
  }
  if (from === to) return;
  const allowed = allowedNextStatuses(from);
  if (!allowed.includes(to)) {
    throw new Error(`Illegal status transition "${from}" -> "${to}". Allowed from "${from}": ${allowed.join(', ') || '(none)'}`);
  }
}

export interface CreateIssueInput {
  title: string;
  description?: string | null;
  priority?: string;
  status?: string;
  context?: string | null;
  acceptanceCriteria?: string | null;
  technicalIntent?: string | null;
  parentId?: string | null;
  parentIdentifier?: string | null;
  cycleId?: string | null;
  roadmapId?: string | null;
  productId?: string | null;
  productSlug?: string | null;
  projectId?: string | null;
  repoId?: string | null;
}

// Single creation path shared by the UI server action, both MCP servers,
// and the webhooks, so every surface mints product-namespaced identifiers
// and honors the issue protocol the same way. Issues with no product land
// in the FLX workspace product (when it exists), keeping dashboard counts
// in agreement with identifier prefixes.
export async function createNamespacedIssue(input: CreateIssueInput) {
  const status = input.status || 'Todo';
  if (!isValidStatus(status)) {
    throw new Error(`Invalid initial status "${status}". Valid statuses: ${VALID_STATUSES.join(', ')}`);
  }

  let product = null;
  if (input.productId) {
    product = await prisma.product.findUnique({ where: { id: input.productId } });
    if (!product) throw new Error(`Product not found for id: ${input.productId}`);
  } else if (input.productSlug) {
    product = await prisma.product.findUnique({ where: { slug: input.productSlug.toUpperCase().trim() } });
    if (!product) throw new Error(`Product not found for slug: ${input.productSlug}`);
  } else {
    product = await prisma.product.findUnique({ where: { slug: WORKSPACE_SLUG } });
  }

  let parentId: string | null = null;
  if (input.parentId) {
    const parent = await prisma.issue.findUnique({ where: { id: input.parentId } });
    if (!parent) throw new Error(`Parent issue not found for id: ${input.parentId}`);
    parentId = parent.id;
  } else if (input.parentIdentifier) {
    const parent = await prisma.issue.findUnique({ where: { identifier: input.parentIdentifier.toUpperCase().trim() } });
    if (!parent) throw new Error(`Parent issue not found for identifier: ${input.parentIdentifier}`);
    parentId = parent.id;
  }

  const slug = product?.slug ?? WORKSPACE_SLUG;
  const identifier = await nextIssueIdentifier(prisma, slug, slug === WORKSPACE_SLUG ? 100 : 0);

  return prisma.issue.create({
    data: {
      identifier,
      title: input.title,
      description: input.description || null,
      priority: input.priority || 'Medium',
      status,
      context: input.context || null,
      acceptanceCriteria: input.acceptanceCriteria || null,
      technicalIntent: input.technicalIntent || null,
      parentId,
      cycleId: input.cycleId || null,
      roadmapId: input.roadmapId || null,
      productId: product?.id ?? null,
      projectId: input.projectId || null,
      repoId: input.repoId || null,
    },
  });
}
