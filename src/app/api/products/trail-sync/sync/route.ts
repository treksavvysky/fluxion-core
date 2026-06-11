import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  validateBatchRequest,
  reconcileBatch,
  getRecentBatches,
  TrailSyncValidationError,
} from '@/lib/trail-sync';
import { isAuthorized, unauthorizedResponse } from '@/lib/api-auth';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!isAuthorized(req, body?.apiKey)) {
      return unauthorizedResponse();
    }

    const batchRequest = validateBatchRequest(body);
    console.log(
      `[TrailSync] Ingesting batch ${batchRequest.batchKey} (${batchRequest.deltas.length} deltas) from ${batchRequest.deviceId ?? 'unknown device'}`
    );

    const result = await reconcileBatch(batchRequest);

    if (!result.alreadyApplied) {
      revalidatePath('/');
      revalidatePath('/products');
    }

    return NextResponse.json(
      { success: true, ...result },
      { status: result.alreadyApplied ? 200 : 201 }
    );
  } catch (error: unknown) {
    if (error instanceof TrailSyncValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[TrailSync] Error reconciling batch:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return unauthorizedResponse();
    }
    const batches = await getRecentBatches();
    return NextResponse.json(batches, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
