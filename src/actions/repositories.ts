'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getRepositories() {
  return prisma.repository.findMany({
    orderBy: { name: 'asc' },
    include: {
      product: { select: { name: true } },
      _count: { select: { issues: true } }
    }
  });
}

export async function createRepository(data: { name: string; url?: string; productId?: string }) {
  const repo = await prisma.repository.create({ data });
  revalidatePath('/repositories');
  return repo;
}
