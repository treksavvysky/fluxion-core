import { getIssueById } from '@/actions/issue';
import { getCycles } from '@/actions/cycles';
import { getProducts } from '@/actions/products';
import { getProjects } from '@/actions/projects';
import { getRepositories } from '@/actions/repositories';
import { allowedNextStatuses } from '@/lib/issues';
import { X } from 'lucide-react';
import Link from 'next/link';
import styles from './issue-peek.module.css';
import StatusUpdater from './StatusUpdater';
import CycleAssigner from './CycleAssigner';
import ProductAssigner from './ProductAssigner';
import ProjectAssigner from './ProjectAssigner';
import RepositoryAssigner from './RepositoryAssigner';

export default async function IssuePeek({ issueId }: { issueId: string }) {
  const issue = await getIssueById(issueId);
  const cycles = await getCycles();
  const products = await getProducts();
  const projects = await getProjects();
  const repos = await getRepositories();

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
          <StatusUpdater issueId={issue.id} currentStatus={issue.status} allowedStatuses={allowedNextStatuses(issue.status)} />
          
          <span className={styles.metaLabel}>Priority</span>
          <span style={{ color: 'var(--text-primary)' }}>{issue.priority}</span>
          
          <span className={styles.metaLabel}>Cycle</span>
          <CycleAssigner issueId={issue.id} currentCycleId={issue.cycleId} cycles={cycles} />

          <span className={styles.metaLabel}>Product</span>
          <ProductAssigner issueId={issue.id} currentProductId={issue.productId} products={products} />

          <span className={styles.metaLabel}>Project</span>
          <ProjectAssigner issueId={issue.id} currentProjectId={issue.projectId} projects={projects} />

          <span className={styles.metaLabel}>Repository</span>
          <RepositoryAssigner issueId={issue.id} currentRepoId={issue.repoId} repositories={repos} />
        </div>

        {(issue.parent || issue.children.length > 0) && (
          <div style={{ marginTop: '24px' }}>
            <h3 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '12px', fontWeight: 600, letterSpacing: '0.05em' }}>Hierarchy</h3>
            {issue.parent && (
              <div style={{ fontSize: '13px', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Parent: </span>
                <Link href={`/?issueId=${issue.parent.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                  {issue.parent.identifier}
                </Link>
                <span style={{ color: 'var(--text-muted)' }}> — {issue.parent.title}</span>
              </div>
            )}
            {issue.children.map(child => (
              <div key={child.id} style={{ fontSize: '13px', marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-muted)' }}>└ </span>
                <Link href={`/?issueId=${child.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                  {child.identifier}
                </Link>
                <span style={{ color: 'var(--text-muted)' }}> — {child.title} ({child.status})</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: '32px' }}>
          <h3 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '12px', fontWeight: 600, letterSpacing: '0.05em' }}>Description</h3>
          <div className={styles.description}>
            {issue.description || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>No description provided.</span>}
          </div>
        </div>

        {[
          { label: 'Context', value: issue.context },
          { label: 'Acceptance Criteria', value: issue.acceptanceCriteria },
          { label: 'Technical Intent', value: issue.technicalIntent },
        ].filter(s => s.value).map(section => (
          <div key={section.label} style={{ marginTop: '24px' }}>
            <h3 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '12px', fontWeight: 600, letterSpacing: '0.05em' }}>{section.label}</h3>
            <div className={styles.description}>{section.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

