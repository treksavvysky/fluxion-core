import { prisma } from '@/lib/prisma';
import { nextIssueIdentifier } from '@/lib/identifiers';

export const WORKSPACE_SLUG = 'FLX';

export interface CreateIssueInput {
  title: string;
  description?: string | null;
  priority?: string;
  status?: string;
  cycleId?: string | null;
  roadmapId?: string | null;
  productId?: string | null;
  productSlug?: string | null;
  projectId?: string | null;
  repoId?: string | null;
}

// Single creation path shared by the UI server action and both MCP servers,
// so every surface mints product-namespaced identifiers the same way.
// Issues with no product land in the FLX workspace product (when it exists),
// keeping dashboard counts in agreement with identifier prefixes.
export async function createNamespacedIssue(input: CreateIssueInput) {
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

  const slug = product?.slug ?? WORKSPACE_SLUG;
  const identifier = await nextIssueIdentifier(prisma, slug, slug === WORKSPACE_SLUG ? 100 : 0);

  return prisma.issue.create({
    data: {
      identifier,
      title: input.title,
      description: input.description || null,
      priority: input.priority || 'Medium',
      status: input.status || 'Todo',
      cycleId: input.cycleId || null,
      roadmapId: input.roadmapId || null,
      productId: product?.id ?? null,
      projectId: input.projectId || null,
      repoId: input.repoId || null,
    },
  });
}
