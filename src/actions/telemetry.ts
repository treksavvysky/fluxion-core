'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getBuilds() {
  let builds = await prisma.build.findMany({
    orderBy: { createdAt: 'desc' },
    include: { repo: { select: { name: true } } }
  });

  if (builds.length === 0) {
    // Seed initial mock builds
    const repo = await prisma.repository.findFirst();
    await prisma.build.create({
      data: {
        branch: 'master',
        status: 'Success',
        commitMsg: 'feat: complete frontend updates for Products, Projects, and Repositories',
        commitHash: '38028eb',
        repoId: repo ? repo.id : null
      }
    });
    await prisma.build.create({
      data: {
        branch: 'dev-neon',
        status: 'Building',
        commitMsg: 'debug: configure neon database pool boundaries',
        commitHash: '7cfa12b',
        repoId: repo ? repo.id : null
      }
    });
    builds = await prisma.build.findMany({
      orderBy: { createdAt: 'desc' },
      include: { repo: { select: { name: true } } }
    });
  }

  return builds;
}

export async function getEnvironments() {
  let envs = await prisma.environment.findMany({
    orderBy: { name: 'asc' }
  });

  if (envs.length === 0) {
    // Seed initial mock environments
    await prisma.environment.create({
      data: {
        name: 'Production',
        url: 'https://fluxion-prod.stack.io',
        status: 'Healthy',
        version: 'v1.2.4'
      }
    });
    await prisma.environment.create({
      data: {
        name: 'Staging',
        url: 'https://fluxion-staging.stack.io',
        status: 'Healthy',
        version: 'v1.3.0-rc1'
      }
    });
    envs = await prisma.environment.findMany({
      orderBy: { name: 'asc' }
    });
  }

  return envs;
}

export async function getActivityLogs() {
  let logs = await prisma.activityLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 15
  });

  if (logs.length === 0) {
    // Seed initial mock logs
    await prisma.activityLog.create({
      data: {
        actor: 'Antigravity',
        actorIcon: 'bot',
        action: 'Successfully resolved initialize 405 Method Not Allowed error by implementing dual stateful-stateless HTTP JSON-RPC transport',
        target: 'mcp-server'
      }
    });
    await prisma.activityLog.create({
      data: {
        actor: 'George Loudon',
        actorIcon: 'user',
        action: 'Completed task: Update Frontend UI to Support Products, Projects, and Repositories',
        target: 'FLX-105'
      }
    });
    await prisma.activityLog.create({
      data: {
        actor: 'Antigravity',
        actorIcon: 'bot',
        action: 'Added Product, Project, and Repository metadata models to Prisma schema and pushed migrations to Neon Postgres',
        target: 'database'
      }
    });
    logs = await prisma.activityLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 15
    });
  }

  return logs;
}

export async function logActivity(actor: string, actorIcon: string, action: string, target?: string) {
  const log = await prisma.activityLog.create({
    data: { actor, actorIcon, action, target }
  });
  revalidatePath('/');
  return log;
}
