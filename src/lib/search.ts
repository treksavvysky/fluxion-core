import { prisma } from '@/lib/prisma';

// Multi-index workspace search across Issues, Documents, and Change Control
// logs. Shared by /api/search (command palette) and the search MCP tool.
export async function multiIndexSearch(query: string, take = 5) {
  if (!query.trim()) {
    return { issues: [], documents: [], changeLogs: [] };
  }

  const issues = await prisma.issue.findMany({
    where: {
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { identifier: { contains: query, mode: 'insensitive' } }
      ]
    },
    take,
    select: {
      id: true,
      identifier: true,
      title: true,
    }
  });

  const documents = await prisma.document.findMany({
    where: {
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
        { category: { contains: query, mode: 'insensitive' } }
      ]
    },
    take,
    select: {
      id: true,
      title: true,
      slug: true,
      category: true,
    }
  });

  const changeLogs = await prisma.changeLog.findMany({
    where: {
      OR: [
        { type: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { reason: { contains: query, mode: 'insensitive' } }
      ]
    },
    take,
    select: {
      id: true,
      type: true,
      description: true,
    }
  });

  return { issues, documents, changeLogs };
}
