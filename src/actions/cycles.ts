'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertValidCycleTransition, mintCycleSlug } from '@/lib/cycles';

export async function getCycles() {
  return prisma.cycle.findMany({
    orderBy: { startDate: 'desc' },
    include: { _count: { select: { issues: true } } }
  });
}

export async function getCycleBySlug(slug: string) {
  return prisma.cycle.findUnique({
    where: { slug },
    include: {
      issues: {
        orderBy: { identifier: 'asc' },
        select: {
          id: true, identifier: true, title: true, status: true, priority: true,
          product: { select: { slug: true } },
          parent: { select: { identifier: true } },
        }
      },
      documents: { select: { slug: true, title: true, docType: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } },
    }
  });
}

export async function createCycle(data: { name: string; startDate: Date; endDate: Date; goal?: string; capacityPoints?: number }) {
  let slug = mintCycleSlug(data.name);
  if (await prisma.cycle.findUnique({ where: { slug } })) {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }
  const c = await prisma.cycle.create({ data: { ...data, slug } });
  revalidatePath('/cycles');
  return c;
}

export async function submitCycle(formData: FormData) {
  const name = formData.get('name') as string;
  const goal = (formData.get('goal') as string) || undefined;
  const startDate = formData.get('startDate') as string;
  const endDate = formData.get('endDate') as string;
  const capacity = formData.get('capacityPoints') as string;

  if (!name || !startDate || !endDate) throw new Error('Name, start date, and end date are required');

  const cycle = await createCycle({
    name,
    goal,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    capacityPoints: capacity ? parseInt(capacity, 10) : undefined,
  });

  revalidatePath('/cycles');
  redirect(`/cycles/${cycle.slug}`);
}

// Lifecycle transitions (FLX-129). At most one Active cycle: activating
// while another is Active is rejected, naming the conflict.
export async function updateCycleLifecycle(id: string, status: string) {
  const existing = await prisma.cycle.findUnique({ where: { id } });
  if (!existing) throw new Error('Cycle not found');
  assertValidCycleTransition(existing.status, status);

  if (status === 'Active') {
    const conflict = await prisma.cycle.findFirst({ where: { status: 'Active', id: { not: id } } });
    if (conflict) {
      throw new Error(`Cannot activate "${existing.name}": cycle "${conflict.name}" is already Active. Complete it first — only one cycle carries momentum at a time.`);
    }
  }

  const cycle = await prisma.cycle.update({ where: { id }, data: { status } });
  revalidatePath('/cycles');
  if (cycle.slug) revalidatePath(`/cycles/${cycle.slug}`);
  return cycle;
}

export async function assignIssueToCycle(issueId: string, cycleId: string | null) {
  const issue = await prisma.issue.update({
    where: { id: issueId },
    data: { cycleId: cycleId === 'none' ? null : cycleId }
  });
  revalidatePath('/');
  revalidatePath('/cycles');
  return issue;
}
