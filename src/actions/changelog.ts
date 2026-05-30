'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function getChangeLogs() {
  // Check if there are change logs, and seed them if empty
  const count = await prisma.changeLog.count();
  if (count === 0) {
    await seedChangeLogs();
  }

  return prisma.changeLog.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      issue: { select: { title: true } },
      repo: { select: { name: true } },
      product: { select: { name: true } },
    },
  });
}

export async function createChangeLog(data: {
  type: string;
  description: string;
  reason?: string;
  approvedBy: string;
  implementedBy: string;
  issueId?: string;
  repoId?: string;
  productId?: string;
}) {
  const log = await prisma.changeLog.create({
    data: {
      type: data.type,
      description: data.description,
      reason: data.reason || null,
      approvedBy: data.approvedBy,
      implementedBy: data.implementedBy,
      issueId: data.issueId || null,
      repoId: data.repoId || null,
      productId: data.productId || null,
    }
  });
  revalidatePath('/change-control');
  return log;
}

export async function submitChangeLog(formData: FormData) {
  const type = formData.get('type') as string;
  const description = formData.get('description') as string;
  const reason = formData.get('reason') as string || '';
  const approvedBy = formData.get('approvedBy') as string;
  const implementedBy = formData.get('implementedBy') as string;
  const productId = formData.get('productId') as string;
  const repoId = formData.get('repoId') as string;
  const issueId = formData.get('issueId') as string;

  if (!type || !description || !approvedBy || !implementedBy) {
    throw new Error('Required fields are missing');
  }

  await prisma.changeLog.create({
    data: {
      type,
      description,
      reason: reason || null,
      approvedBy,
      implementedBy,
      productId: productId && productId !== 'none' ? productId : null,
      repoId: repoId && repoId !== 'none' ? repoId : null,
      issueId: issueId && issueId !== 'none' ? issueId : null,
    }
  });

  revalidatePath('/change-control');
  redirect('/change-control');
}

async function seedChangeLogs() {
  const repo = await prisma.repository.findFirst();
  const product = await prisma.product.findFirst();
  const issue = await prisma.issue.findFirst();

  const repoId = repo?.id || null;
  const productId = product?.id || null;
  const issueId = issue?.id || null;

  const mockLogs = [
    {
      type: 'Migration',
      description: 'Add ChangeLog schema to support high-integrity auditable change control records.',
      reason: 'User requested prioritization of Change Control over Documentation Hub',
      approvedBy: 'George Loudon',
      implementedBy: 'Antigravity',
      repoId,
      productId,
      issueId,
      createdAt: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
    },
    {
      type: 'Deployment',
      description: 'Deploy Next.js command center v1.0.4 with resilient MCP Server-Sent Events architecture.',
      reason: 'Fix SSE proxy buffering on /api/mcp',
      approvedBy: 'George Loudon',
      implementedBy: 'Antigravity',
      repoId,
      productId,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3), // 3 hours ago
    },
    {
      type: 'API Release',
      description: 'Expose /api/mcp endpoint supporting dual stateful SSE and stateless JSON-RPC.',
      reason: 'Eliminate stale global transport session timeouts',
      approvedBy: 'George Loudon',
      implementedBy: 'Antigravity',
      repoId,
      productId,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
    },
    {
      type: 'Config Change',
      description: 'Enable Prisma Client caching reload configuration in docker-compose.yml.',
      reason: 'Synchronize schema updates with live-sync volume mounts',
      approvedBy: 'George Loudon',
      implementedBy: 'George Loudon',
      repoId,
      productId,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3), // 3 days ago
    },
  ];

  for (const log of mockLogs) {
    await prisma.changeLog.create({
      data: log,
    });
  }
}
