import styles from './change-control.module.css';
import { ShieldCheck, Calendar, User, CheckSquare, Plus, Package, GitBranch, AlertCircle } from 'lucide-react';
import { getChangeLogs } from '@/actions/changelog';
import { prisma } from '@/lib/prisma';
import NewChangeLogModal from '@/components/NewChangeLogModal';
import Link from 'next/link';

function getTypeStyle(type: string) {
  switch (type) {
    case 'Deployment': return styles.typeDeployment;
    case 'Migration': return styles.typeMigration;
    case 'API Release': return styles.typeApiRelease;
    case 'Config Change': return styles.typeConfigChange;
    default: return '';
  }
}

export default async function ChangeControlPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const params = await searchParams;
  const isNewOpen = params?.new === 'true';

  const logs = await getChangeLogs();

  // Fetch scope records for the new log form modal
  const products = await prisma.product.findMany({ select: { id: true, name: true } });
  const repos = await prisma.repository.findMany({ where: { archivedAt: null }, select: { id: true, name: true } });
  const issues = await prisma.issue.findMany({ select: { id: true, title: true, identifier: true } });

  return (
    <>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>
              <ShieldCheck size={24} style={{ color: 'var(--accent)', marginRight: '8px' }} />
              Change Control Log
            </h1>
            <span className={styles.badge}>
              Auditable, high-integrity trail of system deployments, database migrations, and release lifecycle events.
            </span>
          </div>
          <div>
            <Link href="/change-control?new=true">
              <button className={styles.newBtn}>
                <Plus size={14} /> Register Change
              </button>
            </Link>
          </div>
        </header>

        {logs.length === 0 ? (
          <div className={styles.emptyState}>
            <AlertCircle size={48} style={{ color: 'var(--text-muted)' }} />
            <h3 className={styles.emptyTitle}>No Change Logs</h3>
            <p className={styles.emptyText}>
              There are no registered change control events in this workspace yet. Register your first deploy or migration event.
            </p>
            <Link href="/change-control?new=true">
              <button className={styles.newBtn}>
                <Plus size={14} /> Register Change
              </button>
            </Link>
          </div>
        ) : (
          <div className={styles.timeline}>
            {logs.map((log) => (
              <div key={log.id} className={styles.timelineItem}>
                <div className={styles.timelineDot} />
                <div className={styles.changeCard}>
                  <div className={styles.cardHeader}>
                    <div className={styles.metaGroup}>
                      <span className={`${styles.typeBadge} ${getTypeStyle(log.type)}`}>
                        {log.type}
                      </span>
                      <div className={styles.auditMeta}>
                        <span className={styles.auditMetaSpan} title="Implemented By">
                          <User size={12} style={{ marginRight: '4px' }} />
                          <strong>By:</strong> {log.implementedBy}
                        </span>
                        {log.approvedBy && (
                          <span className={styles.auditMetaSpan} title="Approved By">
                            <ShieldCheck size={12} style={{ color: '#10b981', marginRight: '4px' }} />
                            <strong>Approved:</strong> {log.approvedBy}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={styles.dateText}>
                      <Calendar size={12} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                      {new Date(log.createdAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>

                  <div className={styles.description}>{log.description}</div>

                  {log.reason && (
                    <div className={styles.reasonBox}>
                      <div className={styles.reasonTitle}>Change Rationale</div>
                      <p className={styles.reasonText}>{log.reason}</p>
                    </div>
                  )}

                  {(log.product || log.repo || log.issue) && (
                    <div className={styles.scopes}>
                      {log.product && (
                        <span className={`${styles.scopeTag} ${styles.productScope}`}>
                          <Package size={10} style={{ marginRight: '2px' }} />
                          {log.product.name}
                        </span>
                      )}
                      {log.repo && (
                        <span className={`${styles.scopeTag} ${styles.repoScope}`}>
                          <GitBranch size={10} style={{ marginRight: '2px' }} />
                          {log.repo.name}
                        </span>
                      )}
                      {log.issue && (
                        <span className={`${styles.scopeTag} ${styles.issueScope}`}>
                          <CheckSquare size={10} style={{ marginRight: '2px' }} />
                          {log.issue.title}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isNewOpen && (
        <NewChangeLogModal
          products={products}
          repos={repos}
          issues={issues}
        />
      )}
    </>
  );
}
