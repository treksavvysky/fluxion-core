import { prisma } from '@/lib/prisma';

export const VALID_DOC_TYPES = [
  // Product durable docs (FLX-120)
  'Vision', 'Boundaries', 'Architecture',
  // Project durable docs (FLX-125)
  'Charter', 'Design', 'Risk', 'Retrospective',
  'General',
] as const;

export function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

export interface UpsertDocumentInput {
  title: string;
  content: string;
  slug?: string | null; // explicit slug targets an existing doc for update
  category?: string | null;
  docType?: string | null;
  productId?: string | null;
  repoId?: string | null;
  projectId?: string | null;
}

// Upsert-by-slug with revision history (FLX-120). Replaces the old behavior
// of minting a duplicate document with a random slug suffix on title
// collision: updating an existing slug snapshots its prior state into
// DocumentRevision, then applies the new content.
export async function upsertDocument(input: UpsertDocumentInput) {
  if (!input.title || !input.content) {
    throw new Error('title and content are required');
  }
  const docType = input.docType || 'General';
  if (!(VALID_DOC_TYPES as readonly string[]).includes(docType)) {
    throw new Error(`Invalid docType "${docType}". Valid types: ${VALID_DOC_TYPES.join(', ')}`);
  }

  const slug = (input.slug || slugifyTitle(input.title)).trim();
  const existing = await prisma.document.findUnique({ where: { slug } });

  if (existing) {
    const [, updated] = await prisma.$transaction([
      prisma.documentRevision.create({
        data: {
          documentId: existing.id,
          title: existing.title,
          content: existing.content,
          category: existing.category,
          docType: existing.docType,
        },
      }),
      prisma.document.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          content: input.content,
          category: input.category || existing.category,
          docType: input.docType || existing.docType,
          productId: input.productId !== undefined ? input.productId : existing.productId,
          repoId: input.repoId !== undefined ? input.repoId : existing.repoId,
          projectId: input.projectId !== undefined ? input.projectId : existing.projectId,
        },
      }),
    ]);
    return { document: updated, created: false };
  }

  const created = await prisma.document.create({
    data: {
      title: input.title,
      slug,
      content: input.content,
      category: input.category || 'General',
      docType,
      productId: input.productId || null,
      repoId: input.repoId || null,
      projectId: input.projectId || null,
    },
  });
  return { document: created, created: true };
}
