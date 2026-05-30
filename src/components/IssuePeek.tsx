import { getIssueById } from '@/actions/issue';
import { getCycles } from '@/actions/cycles';
import { X } from 'lucide-react';
import Link from 'next/link';
import styles from './issue-peek.module.css';
import StatusUpdater from './StatusUpdater';
import CycleAssigner from './CycleAssigner';

export default async function IssuePeek({ issueId }: { issueId: string }) {
  const issue = await getIssueById(issueId);
  const cycles = await getCycles();
  if (!issue) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.idBadge}>{issue.identifier}</span>
        <div className={styles.actions}>
          <Link href="/" className={styles.closeBtn}>
            <X size={18} />
          </Link>
        </div>
      </div>
      <div className={styles.content}>
        <h2 className={styles.title}>{issue.title}</h2>
        
        <div className={styles.metaGrid}>
          <span className={styles.metaLabel}>Status</span>
          <StatusUpdater issueId={issue.id} currentStatus={issue.status} />
          
          <span className={styles.metaLabel}>Priority</span>
          <span style={{ color: 'var(--text-primary)' }}>{issue.priority}</span>
          
          <span className={styles.metaLabel}>Cycle</span>
          <CycleAssigner issueId={issue.id} currentCycleId={issue.cycleId} cycles={cycles} />
        </div>

        <div style={{ marginTop: '32px' }}>
          <h3 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '12px', fontWeight: 600, letterSpacing: '0.05em' }}>Description</h3>
          <div className={styles.description}>
            {issue.description || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>No description provided.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
