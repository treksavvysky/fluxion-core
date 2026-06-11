'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { computeProductMetrics } from '@/lib/metrics';

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

export async function getProductMetrics(productId: string) {
  return computeProductMetrics(productId);
}

export async function linkProductToRepository(productId: string, repositoryId: string, pathFilter?: string) {
  const link = await prisma.productRepository.upsert({
    where: {
      productId_repositoryId: { productId, repositoryId }
    },
    update: {
      pathFilter: pathFilter || null
    },
    create: {
      productId,
      repositoryId,
      pathFilter: pathFilter || null
    }
  });

  revalidatePath('/products');
  revalidatePath('/repositories');
  return link;
}

export async function unlinkProductFromRepository(productId: string, repositoryId: string) {
  const link = await prisma.productRepository.delete({
    where: {
      productId_repositoryId: { productId, repositoryId }
    }
  });

  revalidatePath('/products');
  revalidatePath('/repositories');
  return link;
}

export async function getProductRepositories(productId: string) {
  return prisma.productRepository.findMany({
    where: { productId },
    include: {
      repository: true
    }
  });
}

export async function getCyclesWithProductMetrics(productId: string | null) {
  const cycles = await prisma.cycle.findMany({
    orderBy: { startDate: 'desc' },
    include: {
      issues: {
        where: productId && productId !== 'all' ? { productId } : undefined,
        select: { id: true, status: true, priority: true }
      }
    }
  });

  return cycles.map(cycle => {
    const totalIssues = cycle.issues.length;
    const completedIssues = cycle.issues.filter(i => i.status === 'Done').length;
    const completionRate = totalIssues > 0 ? Math.round((completedIssues / totalIssues) * 100) : 0;
    
    // Sprint velocity: High=3pts, Medium=2pts, Low=1pt
    const velocity = cycle.issues
      .filter(i => i.status === 'Done')
      .reduce((sum, i) => {
        if (i.priority === 'High') return sum + 3;
        if (i.priority === 'Medium') return sum + 2;
        return sum + 1;
      }, 0);

    const totalPoints = cycle.issues
      .reduce((sum, i) => {
        if (i.priority === 'High') return sum + 3;
        if (i.priority === 'Medium') return sum + 2;
        return sum + 1;
      }, 0);

    return {
      id: cycle.id,
      name: cycle.name,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      isActive: cycle.isActive,
      totalIssues,
      completedIssues,
      completionRate,
      velocity,
      totalPoints
    };
  });
}
