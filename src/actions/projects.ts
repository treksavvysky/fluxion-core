'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getProjects() {
  return prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { name: true } },
      _count: { select: { issues: true } }
    }
  });
}

export async function createProject(data: { name: string; description?: string; productId?: string; status?: string; startDate?: Date; endDate?: Date }) {
  const project = await prisma.project.create({ data });
  revalidatePath('/projects');
  return project;
}
