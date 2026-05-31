import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || '';

    if (!query.trim()) {
      return NextResponse.json({ issues: [], documents: [], changeLogs: [] });
    }

    // Index 1: Issues Search (title, description, identifier)
    const issues = await prisma.issue.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { identifier: { contains: query, mode: 'insensitive' } }
        ]
      },
      take: 5,
      select: {
        id: true,
        identifier: true,
        title: true,
      }
    });

    // Index 2: Documents Search (title, content, category)
    const documents = await prisma.document.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { content: { contains: query, mode: 'insensitive' } },
          { category: { contains: query, mode: 'insensitive' } }
        ]
      },
      take: 5,
      select: {
        id: true,
        title: true,
        slug: true,
        category: true,
      }
    });

    // Index 3: Change Control Logs Search (type, description, reason)
    const changeLogs = await prisma.changeLog.findMany({
      where: {
        OR: [
          { type: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { reason: { contains: query, mode: 'insensitive' } }
        ]
      },
      take: 5,
      select: {
        id: true,
        type: true,
        description: true,
      }
    });

    return NextResponse.json({
      issues,
      documents,
      changeLogs
    });

  } catch (error: any) {
    console.error('[SearchAPI] Error performing multi-index search:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
