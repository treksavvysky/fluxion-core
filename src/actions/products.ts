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

export async function getProductById(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      _count: { select: { projects: true, repos: true, issues: true } }
    }
  });
}

export async function createProduct(data: { name: string; slug: string; description?: string }) {
  if (!data.name || !data.slug) {
    throw new Error('Name and Slug are required');
  }

  // Enforce uppercase and clean slug format
  const slug = data.slug.toUpperCase().trim().replace(/[^A-Z0-9]+/g, '-');
  if (slug.length < 2 || slug.length > 10) {
    throw new Error('Slug must be between 2 and 10 alphanumeric characters');
  }

  // Verify unique namespacing
  const existing = await prisma.product.findUnique({
    where: { slug }
  });
  if (existing) {
    throw new Error(`Product slug "${slug}" already exists`);
  }

  const product = await prisma.product.create({
    data: {
      name: data.name,
      slug,
      description: data.description || null,
      status: 'Active'
    }
  });

  revalidatePath('/products');
  return product;
}

export async function updateProduct(id: string, data: { name: string; description?: string }) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    throw new Error('Product not found');
  }

  // Soft-deletion rule: Archived products are read-only!
  if (existing.status === 'Archived') {
    throw new Error('Archived products are read-only and cannot be modified');
  }

  const product = await prisma.product.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description || null
    }
  });

  revalidatePath('/products');
  return product;
}

export async function archiveProduct(id: string) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    throw new Error('Product not found');
  }

  // Toggle soft-delete status to Archived
  const product = await prisma.product.update({
    where: { id },
    data: { status: 'Archived' }
  });

  revalidatePath('/products');
  return product;
}

export async function unarchiveProduct(id: string) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    throw new Error('Product not found');
  }

  const product = await prisma.product.update({
    where: { id },
    data: { status: 'Active' }
  });

  revalidatePath('/products');
  return product;
}
