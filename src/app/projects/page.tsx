import styles from '@/app/page.module.css';
import { getProjects } from '@/actions/projects';
import { getProducts } from '@/actions/products';
import { Rocket, Plus } from 'lucide-react';
import Link from 'next/link';
import NewProjectModal from '@/components/NewProjectModal';

function fmtDate(d: Date | null) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const params = await searchParams;
  const isNewOpen = params?.new === 'true';

  const projects = await getProjects();
  const products = isNewOpen ? await getProducts() : [];

  return (
    <>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>Projects</h1>
            <span className={styles.badge}>
              Fixed-term execution containers — click a project to open its ops console.
            </span>
          </div>
          <div className={styles.actions}>
            <Link href="/projects?new=true" style={{ textDecoration: 'none' }}>
              <button className={`${styles.btn} ${styles.btnPrimary}`}>
                <Plus size={14} /> New Project
              </button>
            </Link>
          </div>
        </header>

        <div>
          <div className={styles.listHeader}>
            <div className={styles.colTitle}>Project Name</div>
            <div className={styles.colStatus}>Product</div>
            <div className={styles.colStatus}>Timeline</div>
            <div className={styles.colPriority}>Status & Progress</div>
          </div>

          <div className={styles.issueList}>
            {projects.length === 0 && (
              <div style={{ padding: '24px', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '13px' }}>
                No projects yet. Create one to give a body of work coherence.
              </div>
            )}
            {projects.map(p => {
              const done = p.issues.filter(i => i.status === 'Done').length;
              const pct = p.issues.length ? Math.round((done / p.issues.length) * 100) : 0;
              return (
                <Link href={`/projects/${p.slug ?? p.id}`} key={p.id} style={{ textDecoration: 'none', display: 'block' }}>
                  <div className={styles.issueRow}>
                    <div className={`${styles.colTitle} ${styles.issueTitle}`}>
                      <Rocket size={14} color="#a855f7" style={{ marginRight: 8, verticalAlign: 'middle' }} />
                      {p.name}
                    </div>
                    <div className={styles.colStatus}>
                      <span className={styles.statusBadge}>
                        {p.product?.slug || 'No product'}
                      </span>
                    </div>
                    <div className={styles.colStatus} style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                      {fmtDate(p.startDate)} → {fmtDate(p.endDate)}
                    </div>
                    <div className={styles.colPriority} style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                      {p.status} • {pct}% of {p._count.issues} issues
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {isNewOpen && <NewProjectModal products={products} />}
    </>
  );
}
