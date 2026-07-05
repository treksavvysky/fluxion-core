'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { updateRepository, type RepositoryUpdates } from '@/lib/repositories';

// Archived (soft-deleted) records are excluded by default (FLX-137) — the
// dashboard list and pickers only see live repositories unless asked.
export async function getRepositories(includeArchived = false) {
  return prisma.repository.findMany({
    where: includeArchived ? undefined : { archivedAt: null },
    orderBy: { name: 'asc' },
    include: {
      product: { select: { name: true, slug: true } },
      _count: { select: { issues: true } }
    }
  });
}

export async function createRepository(data: { name: string; url?: string; productId?: string }) {
  const repo = await prisma.repository.create({
    data: {
      name: data.name,
      url: data.url || null,
      productId: data.productId || null,
    }
  });
  revalidatePath('/repositories');
  return repo;
}

// Funnels through the same domain function as the update_repository MCP
// tool (FLX-136), so the dashboard and agents can never enforce different
// rules for repository mutations.
export async function updateRepositoryAction(repoId: string, updates: RepositoryUpdates) {
  const result = await updateRepository({ repoId }, updates);
  revalidatePath('/repositories');
  return result.updated;
}
