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
