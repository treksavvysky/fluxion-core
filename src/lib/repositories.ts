import { prisma } from './prisma';

// Repository record mutation (FLX-136). Repositories are registered in
// stages — a record often exists before its GitHub remote does, names change
// on the host (fionn_ai -> fionn_ai_legacy precedent), and orphaned records
// need re-homing — so name, url, and product assignment are all legitimately
// mutable. This is the single write path for updates: the MCP tool and the
// dashboard server action both funnel through here.

export interface RepositoryRef {
  repoId?: string;
  repoName?: string;
}

export interface RepositoryUpdates {
  name?: string;
  // "none" detaches (sets null); any other string is the new URL
  url?: string;
  // productId "none" (or productSlug "none") detaches from the product
  productId?: string;
  productSlug?: string;
}

// Resolve by UUID, or by name when it identifies exactly one record —
// an ambiguous name lists the candidates instead of guessing.
export async function resolveRepository(ref: RepositoryRef) {
  if (ref.repoId) {
    const repo = await prisma.repository.findUnique({ where: { id: ref.repoId } });
    if (!repo) throw new Error(`Repository not found for id: ${ref.repoId}`);
    return repo;
  }
  if (ref.repoName?.trim()) {
    const matches = await prisma.repository.findMany({
      where: { name: { equals: ref.repoName.trim(), mode: 'insensitive' } },
    });
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) throw new Error(`Repository not found for name: ${ref.repoName}`);
    throw new Error(`Repository name "${ref.repoName}" is ambiguous (${matches.length} records: ${matches.map((m) => m.id).join(', ')}) — use repoId`);
  }
  throw new Error('Provide repoId or repoName to identify the repository');
}

export async function updateRepository(ref: RepositoryRef, updates: RepositoryUpdates) {
  const repo = await resolveRepository(ref);

  const data: { name?: string; url?: string | null; productId?: string | null } = {};

  if (typeof updates.name === 'string') {
    if (!updates.name.trim()) throw new Error('name cannot be empty');
    data.name = updates.name.trim();
  }
  if (typeof updates.url === 'string') {
    const url = updates.url.trim();
    data.url = url && url.toLowerCase() !== 'none' ? url : null;
  }

  const productRef = updates.productId ?? updates.productSlug;
  if (typeof productRef === 'string' && productRef.trim()) {
    if (productRef.trim().toLowerCase() === 'none') {
      data.productId = null;
    } else {
      const product = updates.productId
        ? await prisma.product.findUnique({ where: { id: updates.productId.trim() } })
        : await prisma.product.findUnique({ where: { slug: updates.productSlug!.trim().toUpperCase() } });
      if (!product) {
        throw new Error(`Product not found for ${updates.productId ? `id: ${updates.productId}` : `slug: ${updates.productSlug}`}`);
      }
      data.productId = product.id;
    }
  }

  if (Object.keys(data).length === 0) {
    throw new Error('No updatable fields provided (name, url, productId/productSlug — use "none" to detach url or product)');
  }

  const updated = await prisma.repository.update({ where: { id: repo.id }, data });
  return { previous: repo, updated, changed: Object.keys(data) };
}

// Soft-delete (FLX-137), following the archive_product pattern: idempotent,
// history untouched (issues, commits, change logs stay linked and queryable),
// restorable. There is deliberately no destructive delete path anywhere.
// Webhook auto-registration matches archived records by name so a signal
// never creates a duplicate active record — but it never unarchives either;
// retirement is an operator decision that telemetry must not silently reverse.
export async function archiveRepository(ref: RepositoryRef, restore = false) {
  const repo = await resolveRepository(ref);
  if (restore) {
    if (!repo.archivedAt) return { repo, already: true };
    const updated = await prisma.repository.update({ where: { id: repo.id }, data: { archivedAt: null } });
    return { repo: updated, already: false };
  }
  if (repo.archivedAt) return { repo, already: true };
  const updated = await prisma.repository.update({ where: { id: repo.id }, data: { archivedAt: new Date() } });
  return { repo: updated, already: false };
}
