import { prisma } from './prisma';

// Product lifecycle (FLX-120). Mirrors the issue state-machine pattern:
// one transition graph, enforced wherever status changes.
export const VALID_PRODUCT_STATUSES = ['Concept', 'Active', 'Maintenance', 'Sunset', 'Archived'] as const;

export const PRODUCT_TRANSITIONS: Record<string, string[]> = {
  'Concept':     ['Active', 'Archived'],
  'Active':      ['Maintenance', 'Sunset', 'Archived'],
  'Maintenance': ['Active', 'Sunset', 'Archived'],
  'Sunset':      ['Maintenance', 'Archived'],
  'Archived':    ['Active'],
};

export function isValidProductStatus(status: string): boolean {
  return (VALID_PRODUCT_STATUSES as readonly string[]).includes(status);
}

export function allowedNextProductStatuses(from: string): string[] {
  return PRODUCT_TRANSITIONS[from] ?? [];
}

export function assertValidProductTransition(from: string, to: string): void {
  if (!isValidProductStatus(to)) {
    throw new Error(`Invalid product status "${to}". Valid statuses: ${VALID_PRODUCT_STATUSES.join(', ')}`);
  }
  if (from === to) return;
  const allowed = allowedNextProductStatuses(from);
  if (!allowed.includes(to)) {
    throw new Error(`Illegal product status transition "${from}" -> "${to}". Allowed from "${from}": ${allowed.join(', ') || '(none)'}`);
  }
}

// Durable-doc slots every product should carry (concise scope-guard briefs;
// full documentation lives in the linked repository as source of truth).
export const DURABLE_DOC_TYPES = [
  { docType: 'Vision', label: 'Vision & Strategy' },
  { docType: 'Boundaries', label: 'Domain & Boundaries' },
  { docType: 'Architecture', label: 'Architecture Brief' },
] as const;

// Product detail edits (FLX-147): name and description. This is the single
// write path — the MCP update_product tool, the dashboard server action and
// PUT /api/products/[id] all funnel through here. Partial updates: an omitted
// field is left unchanged; an empty description clears it.
export interface ProductDetailUpdates {
  name?: string;
  description?: string | null;
}

export async function updateProductDetails(id: string, updates: ProductDetailUpdates) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    throw new Error('Product not found');
  }

  // Soft-deletion rule: Archived products are read-only!
  if (existing.status === 'Archived') {
    throw new Error('Archived products are read-only and cannot be modified');
  }

  const data: { name?: string; description?: string | null } = {};
  if (typeof updates.name === 'string') {
    if (!updates.name.trim()) throw new Error('name cannot be empty');
    data.name = updates.name.trim();
  }
  if (updates.description === null || typeof updates.description === 'string') {
    data.description = updates.description?.trim() ? updates.description : null;
  }

  if (Object.keys(data).length === 0) {
    throw new Error('No updatable fields provided (name, description)');
  }

  const updated = await prisma.product.update({ where: { id }, data });
  return { previous: existing, updated, changed: Object.keys(data) };
}
