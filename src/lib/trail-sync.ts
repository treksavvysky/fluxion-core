import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { nextIssueIdentifier } from '@/lib/identifiers';
import { VALID_PRIORITIES, isValidStatus, assertValidTransition } from '@/lib/issues';

// FLX-111: Trail-Mode Protocol Delta Ingest & Offline Synchronization.
// Reconciles transaction-logged delta batches captured offline by trail-sync-lens
// devices back into Fluxion Core without race conditions:
//  - Batch idempotency via a client-generated unique batchKey (replays return the stored result).
//  - All deltas in a batch apply sequentially inside one interactive transaction.
//  - Stale deltas (server entity mutated after the delta's clientTimestamp) are
//    logged as conflicts instead of overwriting newer server state.

export const TRAIL_SYNC_SLUG = 'TRAIL-SYNC';

const VALID_OPS = ['issue.create', 'issue.update', 'issue.approve', 'roadmap.update'] as const;

export type TrailSyncOp = (typeof VALID_OPS)[number];

export interface TrailSyncDelta {
  seq: number;
  op: TrailSyncOp;
  clientTimestamp: string; // ISO-8601, when the operation happened on the device
  targetRef?: string; // issue identifier or roadmap name for update/approve ops
  payload: Record<string, unknown>;
}

export interface TrailSyncBatchRequest {
  batchKey: string;
  source?: string;
  deviceId?: string;
  capturedAt?: string;
  deltas: TrailSyncDelta[];
}

export interface DeltaResult {
  seq: number;
  op: string;
  status: 'Applied' | 'Conflict' | 'Rejected';
  resolution: string;
  resultRef?: string;
}

export interface BatchResult {
  batchId: string;
  batchKey: string;
  status: string;
  alreadyApplied: boolean;
  deltaCount: number;
  appliedCount: number;
  conflictCount: number;
  rejectedCount: number;
  results: DeltaResult[];
}

export class TrailSyncValidationError extends Error {}

function parseTimestamp(value: unknown, label: string): Date {
  if (typeof value !== 'string' || isNaN(Date.parse(value))) {
    throw new TrailSyncValidationError(`${label} must be a valid ISO-8601 timestamp`);
  }
  return new Date(value);
}

export function validateBatchRequest(body: unknown): TrailSyncBatchRequest {
  if (!body || typeof body !== 'object') {
    throw new TrailSyncValidationError('Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;

  if (typeof b.batchKey !== 'string' || !b.batchKey.trim()) {
    throw new TrailSyncValidationError('batchKey is required and must be a non-empty string');
  }
  if (!Array.isArray(b.deltas) || b.deltas.length === 0) {
    throw new TrailSyncValidationError('deltas must be a non-empty array');
  }
  if (b.capturedAt !== undefined) parseTimestamp(b.capturedAt, 'capturedAt');

  const seen = new Set<number>();
  for (const raw of b.deltas) {
    if (!raw || typeof raw !== 'object') {
      throw new TrailSyncValidationError('Each delta must be an object');
    }
    const d = raw as Record<string, unknown>;
    if (typeof d.seq !== 'number' || !Number.isInteger(d.seq)) {
      throw new TrailSyncValidationError('Each delta requires an integer seq');
    }
    if (seen.has(d.seq)) {
      throw new TrailSyncValidationError(`Duplicate delta seq ${d.seq} in batch`);
    }
    seen.add(d.seq);
    if (typeof d.op !== 'string' || !VALID_OPS.includes(d.op as TrailSyncOp)) {
      throw new TrailSyncValidationError(
        `Delta seq ${d.seq}: op must be one of ${VALID_OPS.join(', ')}`
      );
    }
    parseTimestamp(d.clientTimestamp, `Delta seq ${d.seq}: clientTimestamp`);
    if (!d.payload || typeof d.payload !== 'object') {
      throw new TrailSyncValidationError(`Delta seq ${d.seq}: payload must be an object`);
    }
  }

  return {
    batchKey: b.batchKey.trim(),
    source: typeof b.source === 'string' ? b.source : 'trail-sync-lens',
    deviceId: typeof b.deviceId === 'string' ? b.deviceId : undefined,
    capturedAt: typeof b.capturedAt === 'string' ? b.capturedAt : undefined,
    deltas: (b.deltas as TrailSyncDelta[]).slice().sort((a, z) => a.seq - z.seq),
  };
}

type Tx = Prisma.TransactionClient;

// Per-batch reconciliation context. `refs` maps device-local clientRefs to the
// server identifiers minted for them, so later deltas in the same batch can
// target issues the device created offline. `touched` holds entities already
// written by this batch — within-batch ordering is authoritative by seq, so
// they bypass the cross-batch staleness check.
interface BatchContext {
  refs: Map<string, string>;
  touched: Set<string>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// Staleness must be judged against logical edit time, not server wall clock.
// When the most recent server-side modification was made by the sync engine
// itself, the entity's updatedAt reflects sync-APPLY time — comparing offline
// deltas against it would false-conflict every multi-batch offline session
// (a device syncing two batches at one ridge connection captured both before
// the server saw either). In that case the baseline is the applied delta's
// clientTimestamp. The epsilon absorbs skew between Prisma's client-side
// @updatedAt clock and Postgres' transaction-start now().
const SYNC_APPLY_EPSILON_MS = 5000;

async function stalenessBaseline(tx: Tx, targetRef: string, serverUpdatedAt: Date): Promise<Date> {
  const lastSync = await tx.syncDelta.findFirst({
    where: { resultRef: targetRef, status: 'Applied' },
    orderBy: { createdAt: 'desc' },
  });
  if (lastSync && serverUpdatedAt.getTime() <= lastSync.createdAt.getTime() + SYNC_APPLY_EPSILON_MS) {
    return lastSync.clientTimestamp;
  }
  return serverUpdatedAt;
}

async function applyDelta(
  tx: Tx,
  productId: string,
  productSlug: string,
  delta: TrailSyncDelta,
  ctx: BatchContext
): Promise<DeltaResult> {
  const ts = new Date(delta.clientTimestamp);
  const p = delta.payload;

  if (delta.op === 'issue.create') {
    const title = asString(p.title);
    if (!title) {
      return { seq: delta.seq, op: delta.op, status: 'Rejected', resolution: 'payload.title is required' };
    }
    const status = asString(p.status) ?? 'Todo';
    const priority = asString(p.priority) ?? 'Medium';
    if (!isValidStatus(status)) {
      return { seq: delta.seq, op: delta.op, status: 'Rejected', resolution: `Invalid status "${status}"` };
    }
    if (!(VALID_PRIORITIES as readonly string[]).includes(priority)) {
      return { seq: delta.seq, op: delta.op, status: 'Rejected', resolution: `Invalid priority "${priority}"` };
    }
    const identifier = await nextIssueIdentifier(tx, productSlug);
    await tx.issue.create({
      data: {
        identifier,
        title,
        description: asString(p.description) ?? null,
        status,
        priority,
        productId,
      },
    });
    const clientRef = asString(p.clientRef);
    if (clientRef) ctx.refs.set(clientRef, identifier);
    ctx.touched.add(identifier);
    return { seq: delta.seq, op: delta.op, status: 'Applied', resolution: 'Issue created', resultRef: identifier };
  }

  if (delta.op === 'issue.update' || delta.op === 'issue.approve') {
    const rawRef = asString(delta.targetRef);
    if (!rawRef) {
      return { seq: delta.seq, op: delta.op, status: 'Rejected', resolution: 'targetRef (issue identifier or clientRef) is required' };
    }
    const ref = ctx.refs.get(rawRef) ?? rawRef;
    const issue = await tx.issue.findUnique({ where: { identifier: ref } });
    if (!issue) {
      return { seq: delta.seq, op: delta.op, status: 'Rejected', resolution: `Issue ${ref} not found` };
    }
    const issueBaseline = ctx.touched.has(ref) ? null : await stalenessBaseline(tx, ref, issue.updatedAt);
    if (issueBaseline && issueBaseline > ts) {
      return {
        seq: delta.seq,
        op: delta.op,
        status: 'Conflict',
        resolution: `Stale delta: ${ref} was modified at ${issueBaseline.toISOString()}, after this offline change (${ts.toISOString()}). Server state preserved.`,
        resultRef: ref,
      };
    }

    if (delta.op === 'issue.approve') {
      const approvedStatus = asString(p.approvedStatus) ?? 'Done';
      try {
        assertValidTransition(issue.status, approvedStatus);
      } catch (e) {
        return { seq: delta.seq, op: delta.op, status: 'Rejected', resolution: e instanceof Error ? e.message : String(e) };
      }
      const approvedBy = asString(p.approvedBy) ?? 'trail-sync-lens';
      await tx.issue.update({ where: { id: issue.id }, data: { status: approvedStatus } });
      await tx.changeLog.create({
        data: {
          type: 'Offline Approval',
          description: `${ref} approved as "${approvedStatus}" via Trail-Mode offline queue`,
          reason: asString(p.reason) ?? null,
          approvedBy,
          implementedBy: 'trail-sync-lens',
          issueId: issue.id,
          productId,
        },
      });
      ctx.touched.add(ref);
      return { seq: delta.seq, op: delta.op, status: 'Applied', resolution: `Approved as ${approvedStatus}`, resultRef: ref };
    }

    const data: Prisma.IssueUpdateInput = {};
    const status = asString(p.status);
    const priority = asString(p.priority);
    if (status) {
      try {
        assertValidTransition(issue.status, status);
      } catch (e) {
        return { seq: delta.seq, op: delta.op, status: 'Rejected', resolution: e instanceof Error ? e.message : String(e) };
      }
      data.status = status;
    }
    if (priority) {
      if (!(VALID_PRIORITIES as readonly string[]).includes(priority)) {
        return { seq: delta.seq, op: delta.op, status: 'Rejected', resolution: `Invalid priority "${priority}"` };
      }
      data.priority = priority;
    }
    const title = asString(p.title);
    if (title) data.title = title;
    if (typeof p.description === 'string') data.description = p.description;
    if (Object.keys(data).length === 0) {
      return { seq: delta.seq, op: delta.op, status: 'Rejected', resolution: 'No updatable fields in payload' };
    }
    await tx.issue.update({ where: { id: issue.id }, data });
    ctx.touched.add(ref);
    return { seq: delta.seq, op: delta.op, status: 'Applied', resolution: 'Issue updated', resultRef: ref };
  }

  // roadmap.update
  const ref = asString(delta.targetRef);
  if (!ref) {
    return { seq: delta.seq, op: delta.op, status: 'Rejected', resolution: 'targetRef (roadmap name) is required' };
  }
  const roadmap = await tx.roadmap.findFirst({
    where: { productId, name: { equals: ref, mode: 'insensitive' } },
  });
  if (!roadmap) {
    return { seq: delta.seq, op: delta.op, status: 'Rejected', resolution: `Roadmap "${ref}" not found in product ${productSlug}` };
  }
  const roadmapBaseline = ctx.touched.has(`roadmap:${roadmap.id}`)
    ? null
    : await stalenessBaseline(tx, roadmap.name, roadmap.updatedAt);
  if (roadmapBaseline && roadmapBaseline > ts) {
    return {
      seq: delta.seq,
      op: delta.op,
      status: 'Conflict',
      resolution: `Stale delta: roadmap "${ref}" was modified at ${roadmapBaseline.toISOString()}, after this offline change (${ts.toISOString()}). Server state preserved.`,
      resultRef: roadmap.name,
    };
  }
  const data: Prisma.RoadmapUpdateInput = {};
  const status = asString(p.status);
  if (status) data.status = status;
  if (typeof p.description === 'string') data.description = p.description;
  if (p.targetDate !== undefined) {
    data.targetDate = parseTimestamp(p.targetDate, `Delta seq ${delta.seq}: payload.targetDate`);
  }
  if (Object.keys(data).length === 0) {
    return { seq: delta.seq, op: delta.op, status: 'Rejected', resolution: 'No updatable fields in payload' };
  }
  await tx.roadmap.update({ where: { id: roadmap.id }, data });
  ctx.touched.add(`roadmap:${roadmap.id}`);
  return { seq: delta.seq, op: delta.op, status: 'Applied', resolution: 'Roadmap updated', resultRef: roadmap.name };
}

function summarize(batchId: string, batchKey: string, status: string, alreadyApplied: boolean, results: DeltaResult[]): BatchResult {
  return {
    batchId,
    batchKey,
    status,
    alreadyApplied,
    deltaCount: results.length,
    appliedCount: results.filter((r) => r.status === 'Applied').length,
    conflictCount: results.filter((r) => r.status === 'Conflict').length,
    rejectedCount: results.filter((r) => r.status === 'Rejected').length,
    results,
  };
}

export async function reconcileBatch(request: TrailSyncBatchRequest): Promise<BatchResult> {
  const product = await prisma.product.findUnique({ where: { slug: TRAIL_SYNC_SLUG } });
  if (!product) {
    throw new Error(`Product namespace ${TRAIL_SYNC_SLUG} is not provisioned`);
  }
  if (product.status !== 'Active') {
    throw new TrailSyncValidationError(`Product ${TRAIL_SYNC_SLUG} is ${product.status}; sync ingest refused`);
  }

  // Idempotency gate: a batchKey that already completed returns its stored outcome.
  // Pending (crashed mid-flight) or Failed batches are reprocessed from scratch.
  let batch;
  try {
    batch = await prisma.syncBatch.create({
      data: {
        batchKey: request.batchKey,
        source: request.source ?? 'trail-sync-lens',
        deviceId: request.deviceId ?? null,
        capturedAt: request.capturedAt ? new Date(request.capturedAt) : null,
        deltaCount: request.deltas.length,
        productId: product.id,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.syncBatch.findUnique({
        where: { batchKey: request.batchKey },
        include: { deltas: { orderBy: { seq: 'asc' } } },
      });
      if (existing && (existing.status === 'Applied' || existing.status === 'Partial')) {
        const results = existing.deltas.map((d) => ({
          seq: d.seq,
          op: d.op,
          status: d.status as DeltaResult['status'],
          resolution: d.resolution ?? '',
          resultRef: d.resultRef ?? undefined,
        }));
        return summarize(existing.id, existing.batchKey, existing.status, true, results);
      }
      if (existing) {
        await prisma.syncDelta.deleteMany({ where: { batchId: existing.id } });
        batch = await prisma.syncBatch.update({
          where: { id: existing.id },
          data: { status: 'Pending', deltaCount: request.deltas.length, appliedCount: 0, conflictCount: 0, rejectedCount: 0 },
        });
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  let results: DeltaResult[];
  try {
    results = await prisma.$transaction(
      async (tx) => {
        const ctx: BatchContext = { refs: new Map(), touched: new Set() };
        const outcomes: DeltaResult[] = [];
        for (const delta of request.deltas) {
          outcomes.push(await applyDelta(tx, product.id, product.slug, delta, ctx));
        }

        await tx.syncDelta.createMany({
          data: request.deltas.map((d, i) => ({
            batchId: batch.id,
            seq: d.seq,
            op: d.op,
            targetRef: d.targetRef ?? null,
            payload: d.payload as Prisma.InputJsonValue,
            clientTimestamp: new Date(d.clientTimestamp),
            status: outcomes[i].status,
            resolution: outcomes[i].resolution,
            resultRef: outcomes[i].resultRef ?? null,
          })),
        });

        const applied = outcomes.filter((r) => r.status === 'Applied').length;
        const batchStatus = applied === outcomes.length ? 'Applied' : applied > 0 ? 'Partial' : 'Failed';
        await tx.syncBatch.update({
          where: { id: batch.id },
          data: {
            status: batchStatus,
            appliedCount: applied,
            conflictCount: outcomes.filter((r) => r.status === 'Conflict').length,
            rejectedCount: outcomes.filter((r) => r.status === 'Rejected').length,
          },
        });

        await tx.activityLog.create({
          data: {
            actor: request.source ?? 'trail-sync-lens',
            actorIcon: 'mountain',
            action: `Synced offline batch ${request.batchKey}: ${applied}/${outcomes.length} deltas applied`,
            target: TRAIL_SYNC_SLUG,
          },
        });

        return outcomes;
      },
      { timeout: 30000 }
    );
  } catch (error: unknown) {
    await prisma.syncBatch.update({ where: { id: batch.id }, data: { status: 'Failed' } });
    throw error;
  }

  const applied = results.filter((r) => r.status === 'Applied').length;
  const status = applied === results.length ? 'Applied' : applied > 0 ? 'Partial' : 'Failed';
  return summarize(batch.id, request.batchKey, status, false, results);
}

export async function getRecentBatches(limit = 20) {
  return prisma.syncBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { deltas: { orderBy: { seq: 'asc' } } },
  });
}
