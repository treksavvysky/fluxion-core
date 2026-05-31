'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function getRules() {
  const count = await prisma.automationRule.count();
  if (count === 0) {
    await seedRules();
  }

  return prisma.automationRule.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

export async function createRule(data: {
  name: string;
  trigger: string;
  condition?: string;
  action: string;
}) {
  const rule = await prisma.automationRule.create({
    data: {
      name: data.name,
      trigger: data.trigger,
      condition: data.condition || null,
      action: data.action,
    },
  });
  revalidatePath('/automations');
  return rule;
}

export async function submitRule(formData: FormData) {
  const name = formData.get('name') as string;
  const trigger = formData.get('trigger') as string;
  const condition = formData.get('condition') as string || '';
  const action = formData.get('action') as string;

  if (!name || !trigger || !action) {
    throw new Error('Name, Trigger, and Action are required');
  }

  await prisma.automationRule.create({
    data: {
      name,
      trigger,
      condition: condition || null,
      action,
    },
  });

  revalidatePath('/automations');
  redirect('/automations');
}

export async function toggleRuleStatus(id: string, active: boolean) {
  await prisma.automationRule.update({
    where: { id },
    data: { isActive: active },
  });
  revalidatePath('/automations');
}

/**
 * Event-Driven Rule Execution Engine
 * Evaluates triggers and performs simulated autonomous DevOps actions.
 */
export async function triggerAutomationEvent(triggerType: string, payload: {
  branch?: string;
  repoName?: string;
  prNumber?: number;
  environmentName?: string;
  statusDetails?: string;
  actor?: string;
}) {
  const activeRules = await prisma.automationRule.findMany({
    where: {
      trigger: triggerType,
      isActive: true,
    },
  });

  console.log(`[RulesEngine] Ingested event ${triggerType}. Found ${activeRules.length} matching active rules.`);

  for (const rule of activeRules) {
    // Condition checks (basic evaluation)
    if (rule.condition) {
      if (rule.condition.includes("branch == 'main'") && payload.branch !== 'main') {
        continue;
      }
      if (rule.condition.includes("branch == 'staging'") && payload.branch !== 'staging') {
        continue;
      }
    }

    let actionMsg = '';
    let actor = 'System';
    let actorIcon = 'bot';

    switch (rule.action) {
      case 'TRIGGER_SELF_HEALING':
        actionMsg = `Rule [${rule.name}] triggered: Dispatched Antigravity self-repair agent to analyze diagnostics and resolve compilation failure on ${payload.repoName || 'repository'} (${payload.branch || 'branch'}).`;
        actor = 'Antigravity';
        break;
      case 'AUTO_DELEGATE':
        actionMsg = `Rule [${rule.name}] triggered: Auto-assigned incident ticket to Antigravity for automated staging cluster recovery. Environment: ${payload.environmentName || 'Staging'}.`;
        actor = 'Antigravity';
        break;
      case 'LOG_AUDIT':
        actionMsg = `Rule [${rule.name}] triggered: Registered high-integrity security release audit trail in Change Control log for branch deploy.`;
        actor = 'System';
        actorIcon = 'system';
        break;
      default:
        actionMsg = `Rule [${rule.name}] triggered: System executed action ${rule.action} for trigger ${triggerType}.`;
    }

    // Register rule execution in ActivityLog
    await prisma.activityLog.create({
      data: {
        actor,
        actorIcon,
        action: actionMsg,
        target: 'SYSTEM',
      },
    });

    console.log(`[RulesEngine] Executed rule [${rule.name}]. Action: ${rule.action}`);
  }

  revalidatePath('/');
}

async function seedRules() {
  const mockRules = [
    {
      name: 'Staging Build Failure Autopilot',
      trigger: 'BUILD_FAILURE',
      condition: "branch == 'staging'",
      action: 'TRIGGER_SELF_HEALING',
      isActive: true,
    },
    {
      name: 'Staging Cluster Outage Recovery',
      trigger: 'HEALTH_DEGRADED',
      condition: '',
      action: 'AUTO_DELEGATE',
      isActive: true,
    },
    {
      name: 'Production Deploy Security Auditor',
      trigger: 'DEPLOYMENT_SUCCESS',
      condition: "branch == 'main'",
      action: 'LOG_AUDIT',
      isActive: true,
    },
  ];

  for (const rule of mockRules) {
    await prisma.automationRule.create({
      data: rule,
    });
  }
}
