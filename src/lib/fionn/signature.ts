import { createHash } from 'node:crypto';

// Fionn M4 — Triage Dedup (FLX-124).
// Deterministic signature for failure signals arriving from the wild
// (CI/CD webhooks). Normalization strips the volatile parts of traces —
// timestamps, hashes, addresses, run numbers — so the "same" failure
// hashes identically across occurrences. Reused by FLX-119 commit routing.

export function normalizeSignal(text: string): string {
  return text
    .toLowerCase()
    // ISO timestamps and date-ish strings
    .replace(/\d{4}-\d{2}-\d{2}[t ]?[\d:.]*z?/g, '<ts>')
    // hex hashes / commit shas / addresses (7+ hex chars)
    .replace(/\b[0-9a-f]{7,}\b/g, '<hash>')
    // uuids
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    // remaining numbers (line numbers, run ids, durations, memory sizes)
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeSignature(service: string | null | undefined, description: string | null | undefined): string {
  const normalized = `${(service || 'unknown').toLowerCase().trim()}::${normalizeSignal(description || '')}`;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}
