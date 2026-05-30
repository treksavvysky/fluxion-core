'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function getIssues() {
  return prisma.issue.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

export async function getIssueById(id: string) {
  return prisma.issue.findUnique({
    where: { id },
  });
}

export async function createIssue(formData: FormData) {
  const title = formData.get('title') as string;
  const description = formData.get('description') as string;
  const priority = formData.get('priority') as string || 'Medium';

  if (!title) return; // Basic validation handling

  const count = await prisma.issue.count();
  const nextId = `FLX-${101 + count}`;

  await prisma.issue.create({
    data: {
      identifier: nextId,
      title,
      description,
      priority,
      status: 'Todo',
    },
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
