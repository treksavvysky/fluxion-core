// Cycle lifecycle (FLX-129). Fourth use of the transition-graph pattern.
// Cycles are time-boxed momentum: at most ONE cycle may be Active at a time
// (enforced in the action layer, which names the conflicting cycle).
export const VALID_CYCLE_STATUSES = ['Planned', 'Active', 'Completed'] as const;

export const CYCLE_TRANSITIONS: Record<string, string[]> = {
  'Planned':   ['Active'],
  'Active':    ['Completed', 'Planned'],
  'Completed': ['Active'], // reopen
};

export function isValidCycleStatus(status: string): boolean {
  return (VALID_CYCLE_STATUSES as readonly string[]).includes(status);
}

export function allowedNextCycleStatuses(from: string): string[] {
  return CYCLE_TRANSITIONS[from] ?? [];
}

export function assertValidCycleTransition(from: string, to: string): void {
  if (!isValidCycleStatus(to)) {
    throw new Error(`Invalid cycle status "${to}". Valid statuses: ${VALID_CYCLE_STATUSES.join(', ')}`);
  }
  if (from === to) return;
  const allowed = allowedNextCycleStatuses(from);
  if (!allowed.includes(to)) {
    throw new Error(`Illegal cycle status transition "${from}" -> "${to}". Allowed from "${from}": ${allowed.join(', ') || '(none)'}`);
  }
}

// Durable-doc slots per cycle (the rest of the cycle taxonomy — board,
// session logs, blockers, velocity — is derived from live data, never prose).
export const CYCLE_DOC_TYPES = [
  { docType: 'CyclePlan', label: 'Cycle Plan', dueWhen: 'always' },
  { docType: 'CycleReview', label: 'Cycle Review', dueWhen: 'completed' },
] as const;

// Velocity weights — MUST stay consistent with getCyclesWithProductMetrics.
export const VELOCITY_WEIGHTS: Record<string, number> = { High: 3, Critical: 3, Medium: 2, Low: 1 };

export function issuePoints(priority: string): number {
  return VELOCITY_WEIGHTS[priority] ?? 1;
}

export function mintCycleSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '').slice(0, 60);
}
