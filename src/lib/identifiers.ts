import { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

// Mints the next product-namespaced issue identifier (FLX-112, TRAIL-SYNC-4, ...).
// Scans the highest existing suffix under the prefix instead of counting rows:
// row counts drift across products sharing the Issue table and break numbering.
// `seed` floors the sequence (FLX issues historically start at 101).
export async function nextIssueIdentifier(db: Db, slug: string, seed = 0): Promise<string> {
  const existing = await db.issue.findMany({
    where: { identifier: { startsWith: `${slug}-` } },
    select: { identifier: true },
  });
  const max = existing.reduce((acc, i) => {
    const n = parseInt(i.identifier.slice(slug.length + 1), 10);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, seed);
  return `${slug}-${max + 1}`;
}
