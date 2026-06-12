import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Rocket, BookOpen, Activity, ScrollText, GitPullRequest } from 'lucide-react';
import { getProjectBySlug } from '@/actions/projects';
import { allowedNextProjectStatuses, PROJECT_DOC_TYPES } from '@/lib/projects';
import ProjectLifecycleUpdater from '@/components/ProjectLifecycleUpdater';
import styles from '@/app/products/[slug]/product-detail.module.css';

function fmtDate(d: Date | null) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProjectBySlug(decodeURIComponent(slug));
  if (!project) notFound();

  const isCompleted = project.status === 'Completed';

  // Derived status report — computed, never stored
  const issues = project.issues;
  const done = issues.filter(i => i.status === 'Done').length;
  const completionPct = issues.length ? Math.round((done / issues.length) * 100) : 0;
  const byStatus = issues.reduce((acc: Record<string, number>, i) => {
    acc[i.status] = (acc[i.status] ?? 0) + 1;
    return acc;
  }, {});
  const blockers = issues.filter(i => i.status !== 'Done' && i.status !== 'Cancelled' && (i.priority === 'High' || i.priority === 'Critical'));

  // Goal-tree grouping: roots (incl. issues whose parent is outside this project) with their in-project children
  const inProject = new Set(issues.map(i => i.id));
  const roots = issues.filter(i => !i.parentId || !inProject.has(i.parentId));
  const childrenOf = (id: string) => issues.filter(i => i.parentId === id);

  const docSlots = PROJECT_DOC_TYPES.map(slot => ({
    ...slot,
    doc: project.documents.find(d => d.docType === slot.docType) ?? null,
  }));

  return (
    <div className={styles.container}>
      <div className={styles.breadcrumb}>
        <Link href="/projects">Projects</Link> / {project.slug}
      </div>

      <header className={styles.header}>
        <Rocket size={22} style={{ color: '#a855f7' }} />
        <h1 className={styles.title}>{project.name}</h1>
        {project.product && (
          <Link href={`/products/${project.product.slug}`} className={styles.slugPill} style={{ textDecoration: 'none' }}>
            {project.product.slug}
          </Link>
        )}
        <div className={styles.headerActions}>
          <span className={styles.docMeta}>{fmtDate(project.startDate)} → {fmtDate(project.endDate)}</span>
          <ProjectLifecycleUpdater
            projectId={project.id}
            currentStatus={project.status}
            allowedStatuses={allowedNextProjectStatuses(project.status)}
          />
        </div>
      </header>

      <p className={styles.scope}>{project.description || 'No project description provided.'}</p>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}><Activity size={12} style={{ verticalAlign: '-2px' }} /> Status Report (derived)</h2>
          <div className={styles.metricRow}><span>Completion</span><span className={styles.metricValue}>{completionPct}% ({done}/{issues.length} issues)</span></div>
          {Object.entries(byStatus).map(([status, count]) => (
            <div key={status} className={styles.metricRow}><span>{status}</span><span className={styles.metricValue}>{count}</span></div>
          ))}
          <div className={styles.metricRow}>
            <span>Open blockers (High/Critical)</span>
            <span className={styles.metricValue} style={{ color: blockers.length ? '#f59e0b' : undefined }}>
              {blockers.length ? blockers.map(b => b.identifier).join(', ') : 'none'}
            </span>
          </div>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}><BookOpen size={12} style={{ verticalAlign: '-2px' }} /> Durable Documentation</h2>
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
          <h2 className={styles.panelTitle}><GitPullRequest size={12} style={{ verticalAlign: '-2px' }} /> Goal Trees ({issues.length} issues)</h2>
          {issues.length === 0 && <div className={styles.empty}>No issues assigned to this project.</div>}
          {roots.map(root => (
            <div key={root.id}>
              <div className={styles.listRow}>
                <Link href={`/?issueId=${root.id}`} className={styles.rowId}>{root.identifier}</Link>
                <span className={styles.rowTitle}>{root.title}</span>
                <span className={styles.rowMeta}>{root.priority} · {root.status}</span>
              </div>
              {childrenOf(root.id).map(child => (
                <div key={child.id} className={styles.listRow} style={{ paddingLeft: '28px' }}>
                  <Link href={`/?issueId=${child.id}`} className={styles.rowId}>{child.identifier}</Link>
                  <span className={styles.rowTitle}>{child.title}</span>
                  <span className={styles.rowMeta}>{child.priority} · {child.status}</span>
                </div>
              ))}
            </div>
          ))}
        </section>

        <section className={`${styles.panel} ${styles.panelWide}`}>
          <h2 className={styles.panelTitle}><ScrollText size={12} style={{ verticalAlign: '-2px' }} /> Decision & Change Log</h2>
          {project.changeLogs.length === 0 && <div className={styles.empty}>No project-scoped change logs yet. Use type &quot;Decision&quot; to preserve major decisions and their rationale.</div>}
          {project.changeLogs.map(log => (
            <div key={log.id} className={styles.listRow}>
              <span className={styles.rowTitle} title={log.reason || ''}>{log.type}: {log.description}</span>
              <span className={styles.rowMeta}>{log.approvedBy} · {new Date(log.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
