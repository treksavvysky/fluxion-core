import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Award, BookOpen, Activity, ShieldAlert, ListChecks, ScrollText } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { getCycleBySlug } from '@/actions/cycles';
import { allowedNextCycleStatuses, CYCLE_DOC_TYPES, issuePoints } from '@/lib/cycles';
import CycleLifecycleUpdater from '@/components/CycleLifecycleUpdater';
import styles from '@/app/products/[slug]/product-detail.module.css';

function fmtDate(d: Date) {
  return new Date(d).toLocaleDateString();
}

const BOARD_GROUPS: { label: string; statuses: string[] }[] = [
  { label: 'In Motion', statuses: ['In Progress'] },
  { label: 'Queued', statuses: ['Todo', 'Backlog', 'Triage'] },
  { label: 'Completed', statuses: ['Done'] },
  { label: 'Deferred', statuses: ['Cancelled'] },
];

export default async function CycleDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cycle = await getCycleBySlug(decodeURIComponent(slug));
  if (!cycle) notFound();

  const isCompleted = cycle.status === 'Completed';
  const issues = cycle.issues;

  // Momentum metrics — derived, never stored
  const donePoints = issues.filter(i => i.status === 'Done').reduce((s, i) => s + issuePoints(i.priority), 0);
  const totalPoints = issues.filter(i => i.status !== 'Cancelled').reduce((s, i) => s + issuePoints(i.priority), 0);
  const doneCount = issues.filter(i => i.status === 'Done').length;
  const blockers = issues.filter(i => i.status !== 'Done' && i.status !== 'Cancelled' && (i.priority === 'High' || i.priority === 'Critical'));

  // Session log: activity within the cycle window (derived view)
  const sessionLog = await prisma.activityLog.findMany({
    where: { createdAt: { gte: cycle.startDate, lte: cycle.endDate } },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });

  const docSlots = CYCLE_DOC_TYPES.map(slot => ({
    ...slot,
    doc: cycle.documents.find(d => d.docType === slot.docType) ?? null,
  }));

  return (
    <div className={styles.container}>
      <div className={styles.breadcrumb}>
        <Link href="/cycles">Sprint Cycles</Link> / {cycle.slug}
      </div>

      <header className={styles.header}>
        <Award size={22} style={{ color: 'var(--accent)' }} />
        <h1 className={styles.title}>{cycle.name}</h1>
        <div className={styles.headerActions}>
          <span className={styles.docMeta}>{fmtDate(cycle.startDate)} → {fmtDate(cycle.endDate)}</span>
          <CycleLifecycleUpdater
            cycleId={cycle.id}
            currentStatus={cycle.status}
            allowedStatuses={allowedNextCycleStatuses(cycle.status)}
          />
        </div>
      </header>

      <p className={styles.scope}>{cycle.goal || 'No cycle goal set — define the primary operational win for this sprint block.'}</p>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}><Activity size={12} style={{ verticalAlign: '-2px' }} /> Momentum (derived)</h2>
          <div className={styles.metricRow}><span>Velocity (points done)</span><span className={styles.metricValue}>{donePoints} / {totalPoints} pts</span></div>
          {cycle.capacityPoints != null && (
            <div className={styles.metricRow}>
              <span>Capacity utilization</span>
              <span className={styles.metricValue} style={{ color: totalPoints > cycle.capacityPoints ? '#f59e0b' : undefined }}>
                {totalPoints} / {cycle.capacityPoints} pts loaded{totalPoints > cycle.capacityPoints ? ' (over capacity)' : ''}
              </span>
            </div>
          )}
          <div className={styles.metricRow}><span>Issues completed</span><span className={styles.metricValue}>{doneCount} / {issues.length}</span></div>
          <div className={styles.metricRow}>
            <span><ShieldAlert size={12} style={{ verticalAlign: '-2px' }} /> Blockers (open High/Critical)</span>
            <span className={styles.metricValue} style={{ color: blockers.length ? '#f59e0b' : undefined }}>
              {blockers.length ? blockers.map(b => b.identifier).join(', ') : 'none'}
            </span>
          </div>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}><BookOpen size={12} style={{ verticalAlign: '-2px' }} /> Cycle Documentation</h2>
          {docSlots.map(slot => {
            const due = slot.dueWhen === 'always' || isCompleted;
            return (
              <div key={slot.docType} className={styles.docSlot}>
                <span className={slot.doc ? styles.docFilled : due ? styles.docMissing : styles.docMeta}>
                  {slot.doc ? '✓' : due ? '✗' : '…'}
                </span>
                {slot.doc ? (
                  <Link href={`/docs?slug=${slot.doc.slug}`} className={styles.docLink}>{slot.label}</Link>
                ) : (
                  <span>{slot.label}</span>
                )}
                <span className={styles.docMeta}>
                  {slot.doc
                    ? `updated ${new Date(slot.doc.updatedAt).toLocaleDateString()}`
                    : slot.dueWhen === 'completed' && !isCompleted
                      ? 'due on completion'
                      : 'missing'}
                </span>
              </div>
            );
          })}
        </section>

        <section className={`${styles.panel} ${styles.panelWide}`}>
          <h2 className={styles.panelTitle}><ListChecks size={12} style={{ verticalAlign: '-2px' }} /> Board ({issues.length} issues)</h2>
          {issues.length === 0 && <div className={styles.empty}>No issues assigned to this cycle yet.</div>}
          {BOARD_GROUPS.map(group => {
            const rows = issues.filter(i => group.statuses.includes(i.status));
            if (rows.length === 0) return null;
            return (
              <div key={group.label}>
                <div className={styles.docMeta} style={{ padding: '10px 0 4px', fontWeight: 600, textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.05em' }}>
                  {group.label} ({rows.length})
                </div>
                {rows.map(issue => (
                  <div key={issue.id} className={styles.listRow}>
                    <Link href={`/?issueId=${issue.id}`} className={styles.rowId}>{issue.identifier}</Link>
                    <span className={styles.rowTitle}>{issue.title}</span>
                    <span className={styles.rowMeta}>{issue.priority} · {issuePoints(issue.priority)} pts{issue.parent ? ` · ↳ ${issue.parent.identifier}` : ''}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </section>

        <section className={`${styles.panel} ${styles.panelWide}`}>
          <h2 className={styles.panelTitle}><ScrollText size={12} style={{ verticalAlign: '-2px' }} /> Session Log (activity in window)</h2>
          {sessionLog.length === 0 && <div className={styles.empty}>No activity recorded within this cycle&apos;s window yet.</div>}
          {sessionLog.map(log => (
            <div key={log.id} className={styles.listRow}>
              <span className={styles.rowTitle} title={log.action}>{log.actor}: {log.action}</span>
              <span className={styles.rowMeta}>{new Date(log.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
