import styles from '@/app/page.module.css';
import { getProjects } from '@/actions/projects';
import { prisma } from '@/lib/prisma';
import { Rocket, Plus } from 'lucide-react';

export default async function ProjectsPage() {
  let projects = await getProjects();
  
  if (projects.length === 0) {
    const product = await prisma.product.findFirst();
    await prisma.project.create({
      data: {
        name: 'Neon DB Migration',
        description: 'Migrate persistence layer to Neon Serverless Postgres.',
        status: 'Active',
        productId: product ? product.id : null
      }
    });
    projects = await getProjects();
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Projects</h1>
          <span className={styles.badge}>{projects.length}</span>
        </div>
        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.btnPrimary}`}>
            <Plus size={14} /> New Project
          </button>
        </div>
      </header>
      
      <div>
        <div className={styles.listHeader}>
          <div className={`${styles.colTitle}`}>Project Name</div>
          <div className={`${styles.colStatus}`}>Product Parent</div>
          <div className={`${styles.colPriority}`}>Status & Workload</div>
        </div>
        
        <div className={styles.issueList}>
          {projects.map(p => (
            <div key={p.id} className={styles.issueRow}>
              <div className={`${styles.colTitle} ${styles.issueTitle}`}>
                <Rocket size={14} color="#a855f7" style={{ marginRight: 8, verticalAlign: 'middle' }}/>
                {p.name}
              </div>
              <div className={styles.colStatus}>
                <span className={styles.statusBadge}>
                   {p.product?.name || 'No product'}
                </span>
              </div>
              <div className={`${styles.colPriority}`} style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                {p.status} • {p._count.issues} issues
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
