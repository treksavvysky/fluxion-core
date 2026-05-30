'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getRoadmaps() {
  return prisma.roadmap.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { issues: true } } }
  });
}

export async function createRoadmap(data: { name: string; targetDate?: Date }) {
  const r = await prisma.roadmap.create({ data });
  revalidatePath('/roadmaps');
  return r;
}
