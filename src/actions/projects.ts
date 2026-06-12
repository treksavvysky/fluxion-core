'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertValidProjectTransition, isValidProjectStatus, mintProjectSlug } from '@/lib/projects';

export async function getProjects() {
  return prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { name: true, slug: true } },
      issues: { select: { status: true } },
      _count: { select: { issues: true } }
    }
  });
}

export async function getProjectBySlug(slug: string) {
  return prisma.project.findUnique({
    where: { slug },
    include: {
      product: { select: { id: true, slug: true, name: true } },
      issues: {
        orderBy: { identifier: 'asc' },
        select: {
          id: true, identifier: true, title: true, status: true, priority: true,
          parentId: true, updatedAt: true,
          parent: { select: { identifier: true } }
        }
      },
      documents: { select: { slug: true, title: true, docType: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } },
      changeLogs: { orderBy: { createdAt: 'desc' }, take: 10 },
    }
  });
}

export async function createProject(data: { name: string; description?: string; productId?: string; status?: string; startDate?: Date; endDate?: Date }) {
  const status = data.status || 'Planned';
  if (!isValidProjectStatus(status)) {
    throw new Error(`Invalid project status "${status}"`);
  }
  let slug = mintProjectSlug(data.name);
  if (await prisma.project.findUnique({ where: { slug } })) {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }
  const project = await prisma.project.create({ data: { ...data, status, slug } });
  revalidatePath('/projects');
  return project;
}

export async function submitProject(formData: FormData) {
  const name = formData.get('name') as string;
  const description = (formData.get('description') as string) || undefined;
  const productId = formData.get('productId') as string;
  const startDate = formData.get('startDate') as string;
  const endDate = formData.get('endDate') as string;

  if (!name) throw new Error('Name is required');

  const project = await createProject({
    name,
    description,
    productId: productId && productId !== 'none' ? productId : undefined,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
  });

  revalidatePath('/projects');
  redirect(`/projects/${project.slug}`);
}

// Lifecycle transitions (FLX-125), validated against the shared graph.
export async function updateProjectLifecycle(id: string, status: string) {
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) throw new Error('Project not found');
  assertValidProjectTransition(existing.status, status);

  const project = await prisma.project.update({ where: { id }, data: { status } });
  revalidatePath('/projects');
  if (project.slug) revalidatePath(`/projects/${project.slug}`);
  return project;
}
