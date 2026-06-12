import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

// Fionn M3 — Verification Gatekeeper (FLX-123).
// Markdown checkboxes in acceptanceCriteria parse into structured criteria;
// executors attest each one with evidence; the In Progress -> Done
// transition is blocked while unattested criteria remain. Attestation
// state lives ONLY in CriterionAttestation rows (a literal "[x]" in the
// markdown is not trusted) — one source of truth, evidence required.

export interface Criterion {
  index: number;
  text: string;
  hash: string;
}

const CHECKBOX_RE = /^\s*[-*]\s*\[[ xX]\]\s+(.+)$/;

export function hashCriterion(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex').slice(0, 32);
}

// Parses "- [ ] ..." / "* [x] ..." lines into criteria. Issues whose
// acceptanceCriteria contain no checkboxes have no gate (backward
// compatible: prose criteria remain advisory).
export function parseCriteria(acceptanceCriteria: string | null | undefined): Criterion[] {
  if (!acceptanceCriteria) return [];
  const criteria: Criterion[] = [];
  for (const line of acceptanceCriteria.split('\n')) {
    const m = line.match(CHECKBOX_RE);
    if (m) {
      const text = m[1].trim();
      criteria.push({ index: criteria.length, text, hash: hashCriterion(text) });
    }
  }
  return criteria;
}

export interface ChecklistItem extends Criterion {
  attested: boolean;
  attestor?: string;
  evidence?: string;
  attestedAt?: Date;
}

export async function getChecklist(
  db: Db,
  issue: { id: string; acceptanceCriteria: string | null }
): Promise<ChecklistItem[]> {
  const criteria = parseCriteria(issue.acceptanceCriteria);
  if (criteria.length === 0) return [];
  const attestations = await db.criterionAttestation.findMany({ where: { issueId: issue.id } });
  const byHash = new Map(attestations.map(a => [a.criterionHash, a]));
  return criteria.map(c => {
    const att = byHash.get(c.hash);
    return att
      ? { ...c, attested: true, attestor: att.attestor, evidence: att.evidence, attestedAt: att.createdAt }
      : { ...c, attested: false };
  });
}

// The Done gate. Throws with the open items listed when checkbox criteria
// remain unattested. No-op for issues without checkbox criteria.
export async function assertDoneGate(
  db: Db,
  issue: { id: string; identifier: string; acceptanceCriteria: string | null }
): Promise<void> {
  const checklist = await getChecklist(db, issue);
  const open = checklist.filter(c => !c.attested);
  if (open.length > 0) {
    throw new Error(
      `Cannot transition ${issue.identifier} to Done: ${open.length} of ${checklist.length} acceptance criteria are unattested. ` +
      `Attest each with evidence via check_criterion first. Open: ${open.map(c => `[${c.index}] ${c.text}`).join(' | ')}`
    );
  }
}
