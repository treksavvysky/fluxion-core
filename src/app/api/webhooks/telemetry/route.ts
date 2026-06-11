import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { triggerAutomationEvent } from '@/actions/automation';
import { isAuthorized, unauthorizedResponse } from '@/lib/api-auth';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!isAuthorized(req, body?.apiKey)) {
      return unauthorizedResponse();
    }

    const { type, payload } = body;
    if (!type || !payload) {
      return NextResponse.json({ error: 'Missing type or payload fields' }, { status: 400 });
    }

    console.log(`[TelemetryWebhook] Received telemetry type: ${type}`);

    if (type === 'build') {
      const { branch = 'main', status = 'Success', commitMsg, commitHash, repoName } = payload;
      if (!repoName) {
        return NextResponse.json({ error: 'Missing repoName in build payload' }, { status: 400 });
      }

      // Find or create repository
      let repo = await prisma.repository.findFirst({
        where: { name: { equals: repoName, mode: 'insensitive' } }
      });
      if (!repo) {
        repo = await prisma.repository.create({
          data: { name: repoName }
        });
      }

      // Create Build record
      const build = await prisma.build.create({
        data: {
          branch,
          status,
          commitMsg: commitMsg || null,
          commitHash: commitHash || null,
          repoId: repo.id
        }
      });

      // Trigger event-driven automation rules based on build status
      if (status === 'Failure') {
        await triggerAutomationEvent('BUILD_FAILURE', {
          branch,
          repoName: repo.name,
          actor: 'System'
        });
      } else if (status === 'Success' && branch === 'master') {
        await triggerAutomationEvent('DEPLOYMENT_SUCCESS', {
          branch,
          repoName: repo.name,
          actor: 'System'
        });
      }

      revalidatePath('/');
      return NextResponse.json({ success: true, type: 'build', data: build }, { status: 201 });
    }

    if (type === 'environment') {
      const { name, status = 'Healthy', url, version } = payload;
      if (!name) {
        return NextResponse.json({ error: 'Missing name in environment payload' }, { status: 400 });
      }

      // Find or create environment by name
      let env = await prisma.environment.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } }
      });

      if (env) {
        env = await prisma.environment.update({
          where: { id: env.id },
          data: {
            status,
            url: url !== undefined ? url : env.url,
            version: version !== undefined ? version : env.version
          }
        });
      } else {
        env = await prisma.environment.create({
          data: { name, status, url: url || null, version: version || null }
        });
      }

      // Trigger automation rule if environment is Degraded or Offline
      if (status === 'Degraded' || status === 'Offline') {
        await triggerAutomationEvent('HEALTH_DEGRADED', {
          environmentName: name,
          statusDetails: status
        });
      }

      revalidatePath('/');
      return NextResponse.json({ success: true, type: 'environment', data: env }, { status: 200 });
    }

    if (type === 'activity') {
      const { actor, actorIcon = 'bot', action, target } = payload;
      if (!actor || !action) {
        return NextResponse.json({ error: 'Missing actor or action in activity payload' }, { status: 400 });
      }

      const log = await prisma.activityLog.create({
        data: { actor, actorIcon, action, target: target || null }
      });

      revalidatePath('/');
      return NextResponse.json({ success: true, type: 'activity', data: log }, { status: 201 });
    }

    return NextResponse.json({ error: `Unsupported telemetry type: ${type}` }, { status: 400 });

  } catch (error: any) {
    console.error('[TelemetryWebhook] Error ingesting telemetry:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
