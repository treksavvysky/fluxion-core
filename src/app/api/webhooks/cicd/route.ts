import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { isAuthorized, unauthorizedResponse } from '@/lib/api-auth';
import { createNamespacedIssue } from '@/lib/issues';
import { computeSignature } from '@/lib/fionn/signature';

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

    // Find or dynamically register the corresponding Code Repository.
    // Deliberately matches archived records too (FLX-137): a signal naming
    // an archived repo must not create a duplicate active record, and must
    // not silently unarchive — retirement is an operator decision.
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

    // Triage dedup (Fionn M4, FLX-124): identical failure signals update
    // the existing open issue instead of filing duplicates. A signal whose
    // prior issue was closed files a fresh Triage issue referencing it —
    // nothing reopens silently.
    const signature = computeSignature(body.service, body.description);
    const OPEN_STATUSES = ['Triage', 'Backlog', 'Todo', 'In Progress'];

    const openMatch = await prisma.issue.findFirst({
        where: { signature, status: { in: OPEN_STATUSES } },
        orderBy: { createdAt: 'desc' }
    });
    if (openMatch) {
        const updated = await prisma.issue.update({
            where: { id: openMatch.id },
            data: {
                occurrences: { increment: 1 },
                lastSeenAt: new Date(),
            }
        });
        revalidatePath('/');
        return NextResponse.json({
            success: true,
            deduplicated: true,
            issue: updated.identifier,
            occurrences: updated.occurrences
        }, { status: 200 });
    }

    const closedMatch = await prisma.issue.findFirst({
        where: { signature, status: { in: ['Done', 'Cancelled'] } },
        orderBy: { createdAt: 'desc' },
        select: { identifier: true, status: true }
    });

    // Webhook-born issues land in Triage: they are unvetted signals, not
    // committed work, until a human or agent promotes them.
    const issue = await createNamespacedIssue({
        title: `[CRITICAL] Pipeline Failure: ${body.service || 'Unknown System'}`,
        description: body.description || 'DevOps Orchestrator emitted a failure event. Ensure system stability.',
        context: `Auto-created from a CI/CD failure webhook.\n- Service: ${body.service || 'unknown'}\n- Branch: ${body.branch || 'unknown'}\n- Received: ${new Date().toISOString()}${closedMatch ? `\n- Recurrence of ${closedMatch.identifier} (${closedMatch.status}) — same failure signature; the prior fix may have regressed.` : ''}`,
        priority: 'High',
        status: 'Triage',
        cycleId: activeCycle ? activeCycle.id : null,
        repoId: repo ? repo.id : null,
        productId: repo ? repo.productId : null
    });
    await prisma.issue.update({ where: { id: issue.id }, data: { signature, lastSeenAt: new Date() } });

    // Trigger Next.js cache revalidation for all UI clients looking at the dashboard
    revalidatePath('/');
    revalidatePath('/cycles');

    return NextResponse.json({ success: true, ingestedIssue: issue }, { status: 201 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
