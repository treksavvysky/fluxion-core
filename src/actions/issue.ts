'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createNamespacedIssue } from '@/lib/issues';

export async function getIssues(filter?: { productSlug?: string }) {
  return prisma.issue.findMany({
    where: filter?.productSlug ? { product: { slug: filter.productSlug } } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { name: true } },
      project: { select: { name: true } },
      repo: { select: { name: true } }
    }
  });
}

export async function getIssueById(id: string) {
  return prisma.issue.findUnique({
    where: { id },
    include: {
      product: { select: { name: true } },
      project: { select: { name: true } },
      repo: { select: { name: true } }
    }
  });
}

export async function createIssue(formData: FormData) {
  const title = formData.get('title') as string;
  const description = formData.get('description') as string;
  const priority = formData.get('priority') as string || 'Medium';
  const productId = (formData.get('productId') as string) || 'none';
  const projectId = (formData.get('projectId') as string) || 'none';
  const repoId = (formData.get('repoId') as string) || 'none';

  if (!title) return; // Basic validation handling

  await createNamespacedIssue({
    title,
    description,
    priority,
    status: 'Todo',
    productId: productId === 'none' ? null : productId,
    projectId: projectId === 'none' ? null : projectId,
    repoId: repoId === 'none' ? null : repoId,
  });

  revalidatePath('/');
  redirect('/'); // Close modal by ripping query param via redirect
}

export async function updateIssueStatus(id: string, newStatus: string) {
  await prisma.issue.update({
    where: { id },
    data: { status: newStatus },
  });
  
  revalidatePath('/');
}

export async function assignIssueDetails(
  issueId: string,
  data: { productId?: string | null; projectId?: string | null; repoId?: string | null }
) {
  const updateData: Prisma.IssueUncheckedUpdateInput = {};
  if (data.productId !== undefined) {
    updateData.productId = data.productId === 'none' ? null : data.productId;
  }
  if (data.projectId !== undefined) {
    updateData.projectId = data.projectId === 'none' ? null : data.projectId;
  }
  if (data.repoId !== undefined) {
    updateData.repoId = data.repoId === 'none' ? null : data.repoId;
  }

  const updated = await prisma.issue.update({
    where: { id: issueId },
    data: updateData,
  });
  
  revalidatePath('/');
  return updated;
}

