import { NextResponse } from 'next/server';
import { multiIndexSearch } from '@/lib/search';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || '';

    const results = await multiIndexSearch(query, 5);
    return NextResponse.json(results);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[SearchAPI] Error performing multi-index search:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
