import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { isAuthorized, unauthorizedResponse } from '@/lib/api-auth';
import { createNamespacedIssue } from '@/lib/issues';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!isAuthorized(req, body?.apiKey)) {
      return unauthorizedResponse();
    }

    // Ensure we only ingest failures
    if (!body || body.status !== 'failure') {
        return NextResponse.json({ message: 'Ignored payload. Status must be "failure"' }, { status: 200 });
    }

    // Find the current Active Cycle based on system date
    const now = new Date();
    const activeCycle = await prisma.cycle.findFirst({
        where: {
            startDate: { lte: now },
            endDate: { gte: now }
        }
    });

    // Find or dynamically register the corresponding Code Repository
    let repo = null;
    if (body.service) {
        repo = await prisma.repository.findFirst({
            where: { name: { equals: body.service, mode: 'insensitive' } }
        });
        if (!repo) {
            repo = await prisma.repository.create({
                data: {
                    name: body.service,
                    url: null
                }
            });
        }
    }

    const issue = await createNamespacedIssue({
        title: `[CRITICAL] Pipeline Failure: ${body.service || 'Unknown System'}`,
        description: body.description || 'DevOps Orchestrator emitted a failure event. Ensure system stability.',
        priority: 'High',
        status: 'Todo',
        cycleId: activeCycle ? activeCycle.id : null,
        repoId: repo ? repo.id : null,
        productId: repo ? repo.productId : null
    });

    // Trigger Next.js cache revalidation for all UI clients looking at the dashboard
    revalidatePath('/');
    revalidatePath('/cycles');

    return NextResponse.json({ success: true, ingestedIssue: issue }, { status: 201 });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
