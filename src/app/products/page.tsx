import styles from '@/app/page.module.css';
import { getProducts } from '@/actions/products';
import { prisma } from '@/lib/prisma';
import { Package, Plus } from 'lucide-react';

export default async function ProductsPage() {
  let products = await getProducts();
  
  if (products.length === 0) {
    await prisma.product.create({
      data: {
        name: 'Fluxion Core Dashboard',
        description: 'Keyboard-centric developer control tower and orchestrator dashboard.'
      }
    });
    products = await getProducts();
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Products</h1>
          <span className={styles.badge}>{products.length}</span>
        </div>
        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.btnPrimary}`}>
            <Plus size={14} /> New Product
          </button>
        </div>
      </header>
      
      <div>
        <div className={styles.listHeader}>
          <div className={`${styles.colTitle}`}>Product Line</div>
          <div className={`${styles.colStatus}`}>Description</div>
          <div className={`${styles.colPriority}`}>Assets & Issues</div>
        </div>
        
        <div className={styles.issueList}>
          {products.map(p => (
            <div key={p.id} className={styles.issueRow}>
              <div className={`${styles.colTitle} ${styles.issueTitle}`}>
                <Package size={14} color="#0ea5e9" style={{ marginRight: 8, verticalAlign: 'middle' }}/>
                {p.name}
              </div>
              <div className={styles.colStatus} style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                {p.description || 'No description provided.'}
              </div>
              <div className={`${styles.colPriority}`} style={{ color: 'var(--text-muted)', fontSize: '12.5px', whiteSpace: 'nowrap' }}>
                {p._count.repos} repos • {p._count.projects} projects • {p._count.issues} issues
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
