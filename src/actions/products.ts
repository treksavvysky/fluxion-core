'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getProducts() {
  return prisma.product.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { projects: true, repos: true, issues: true } }
    }
  });
}

export async function createProduct(data: { name: string; description?: string }) {
  const product = await prisma.product.create({ data });
  revalidatePath('/products');
  return product;
}
