'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getCycles() {
  return prisma.cycle.findMany({
    orderBy: { startDate: 'desc' },
    include: { _count: { select: { issues: true } } }
  });
}

export async function createCycle(data: { name: string; startDate: Date; endDate: Date }) {
  const c = await prisma.cycle.create({ data });
  revalidatePath('/cycles');
  return c;
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
