// Project lifecycle (FLX-125). Third use of the transition-graph pattern
// (issues, products, projects): one graph, enforced wherever status changes.
export const VALID_PROJECT_STATUSES = ['Planned', 'Active', 'On Hold', 'Completed', 'Cancelled'] as const;

export const PROJECT_TRANSITIONS: Record<string, string[]> = {
  'Planned':   ['Active', 'Cancelled'],
  'Active':    ['On Hold', 'Completed', 'Cancelled'],
  'On Hold':   ['Active', 'Cancelled'],
  'Completed': ['Active'], // reopen
  'Cancelled': ['Planned'],
};

export function isValidProjectStatus(status: string): boolean {
  return (VALID_PROJECT_STATUSES as readonly string[]).includes(status);
}

export function allowedNextProjectStatuses(from: string): string[] {
  return PROJECT_TRANSITIONS[from] ?? [];
}

export function assertValidProjectTransition(from: string, to: string): void {
  if (!isValidProjectStatus(to)) {
    throw new Error(`Invalid project status "${to}". Valid statuses: ${VALID_PROJECT_STATUSES.join(', ')}`);
  }
  if (from === to) return;
  const allowed = allowedNextProjectStatuses(from);
  if (!allowed.includes(to)) {
    throw new Error(`Illegal project status transition "${from}" -> "${to}". Allowed from "${from}": ${allowed.join(', ') || '(none)'}`);
  }
}

// Durable-doc slots per project. The Retrospective slot is lifecycle-aware:
// optional while the project runs, due the moment it completes.
export const PROJECT_DOC_TYPES = [
  { docType: 'Charter', label: 'Project Charter', dueWhen: 'always' },
  { docType: 'Design', label: 'Design Brief', dueWhen: 'always' },
  { docType: 'Risk', label: 'Risk & Dependency Register', dueWhen: 'always' },
  { docType: 'Retrospective', label: 'Retrospective', dueWhen: 'completed' },
] as const;

export function mintProjectSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '').slice(0, 60);
}
