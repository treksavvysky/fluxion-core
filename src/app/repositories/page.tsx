import styles from '@/app/page.module.css';
import { getRepositories } from '@/actions/repositories';
import { prisma } from '@/lib/prisma';
import { GitBranch, Plus } from 'lucide-react';

export default async function RepositoriesPage() {
  let repos = await getRepositories();
  
  if (repos.length === 0) {
    const product = await prisma.product.findFirst();
    await prisma.repository.create({
      data: {
        name: 'fluxion-core',
        url: 'https://github.com/fluxion/fluxion-core',
        productId: product ? product.id : null
      }
    });
    repos = await getRepositories();
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Repositories</h1>
          <span className={styles.badge}>{repos.length}</span>
        </div>
        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.btnPrimary}`}>
            <Plus size={14} /> New Repository
          </button>
        </div>
      </header>
      
      <div>
        <div className={styles.listHeader}>
          <div className={`${styles.colTitle}`}>Repository Base</div>
          <div className={`${styles.colStatus}`}>Product Mapping</div>
          <div className={`${styles.colPriority}`}>Issues & Failures</div>
        </div>
        
        <div className={styles.issueList}>
          {repos.map(r => (
            <div key={r.id} className={styles.issueRow}>
              <div className={`${styles.colTitle} ${styles.issueTitle}`}>
                <GitBranch size={14} color="#f97316" style={{ marginRight: 8, verticalAlign: 'middle' }}/>
                {r.name}
                {r.url && <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: '12px', fontWeight: 'normal' }}>{r.url}</span>}
              </div>
              <div className={styles.colStatus}>
                <span className={styles.statusBadge}>
                   {r.product?.name || 'No product'}
                </span>
              </div>
              <div className={`${styles.colPriority}`} style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                {r._count.issues} open issues
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
