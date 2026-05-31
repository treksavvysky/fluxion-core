import styles from './products.module.css';
import { getProducts, archiveProduct, unarchiveProduct, getProductMetrics } from '@/actions/products';
import { prisma } from '@/lib/prisma';
import { Package, Plus, ShieldAlert } from 'lucide-react';
import NewProductModal from '@/components/NewProductModal';
import Link from 'next/link';

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const params = await searchParams;
  const isNewOpen = params?.new === 'true';

  let products = await getProducts();

  // Fallback seeder if list is empty
  if (products.length === 0) {
    await prisma.product.create({
      data: {
        slug: 'FLX',
        name: 'Fluxion Core Dashboard',
        description: 'Keyboard-centric developer control tower and orchestrator dashboard.',
        status: 'Active'
      }
    });
    products = await getProducts();
  }

  // Gather metrics for all products
  const productsWithMetrics = await Promise.all(
    products.map(async (p) => {
      const metrics = await getProductMetrics(p.id);
      return {
        ...p,
        metrics
      };
    })
  );

  return (
    <>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>
              <Package size={24} style={{ color: 'var(--accent)', marginRight: '8px' }} />
              Product Containers
            </h1>
            <span className={styles.badge}>
              Clean domain namespacing (slugs) and data isolation layers for Projects and Issues.
            </span>
          </div>
          <div className={styles.actions}>
            <Link href="/products?new=true">
              <button className={styles.newBtn}>
                <Plus size={14} /> New Product
              </button>
            </Link>
          </div>
        </header>

        <div>
          <div className={styles.tableHeader}>
            <div>Slug</div>
            <div>Product Name</div>
            <div style={{ textAlign: 'center' }}>Status</div>
            <div>Scope Description</div>
            <div>Deliverables</div>
            <div>Defects (O/C)</div>
            <div>Tech Debt</div>
            <div>Roadmap %</div>
            <div style={{ textAlign: 'right' }}>Actions</div>
          </div>

          <div className={styles.issueList} style={{ display: 'flex', flexDirection: 'column' }}>
            {productsWithMetrics.map(p => {
              const debtClass = p.metrics.techDebtPoints > 15 
                ? styles.techDebtHigh 
                : p.metrics.techDebtPoints > 5 
                  ? styles.techDebtMedium 
                  : styles.techDebtLow;

              return (
                <div key={p.id} className={styles.productRow}>
                  <div>
                    <span className={styles.slugCell}>{p.slug}</span>
                  </div>
                  <div className={styles.nameCell}>
                    {p.name}
                  </div>
                  <div>
                    <span className={`${styles.statusPill} ${p.status === 'Archived' ? styles.statusArchived : styles.statusActive}`}>
                      {p.status}
                    </span>
                  </div>
                  <div className={styles.descCell}>
                    {p.description || 'No domain description provided.'}
                  </div>
                  <div className={styles.assetsCell}>
                    {p._count.repos} repos • {p._count.projects} projects
                  </div>
                  <div>
                    <span className={styles.defectsBadge}>
                      <ShieldAlert size={13} style={{ color: p.metrics.openDefects > 0 ? '#f59e0b' : '#10b981' }} />
                      <span style={{ fontWeight: 600, color: p.metrics.openDefects > 0 ? '#f59e0b' : 'inherit' }}>
                        {p.metrics.openDefects}
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>/</span>
                      <span style={{ color: 'var(--text-muted)' }}>{p.metrics.closedDefects}</span>
                    </span>
                  </div>
                  <div>
                    <span className={debtClass}>
                      {p.metrics.techDebtPoints} pts
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600, display: 'flex', justifyContent: 'space-between', paddingRight: '12px' }}>
                      <span>{p.metrics.roadmapCompletion}%</span>
                      <span style={{ color: 'var(--text-muted)' }}>{p.metrics.totalRoadmaps} maps</span>
                    </div>
                    <div className={styles.roadmapProgress}>
                      <div className={styles.roadmapProgressBar} style={{ width: `${p.metrics.roadmapCompletion}%` }}></div>
                    </div>
                  </div>
                  <div className={styles.actionsCell}>
                    {p.status === 'Active' ? (
                      <form action={async () => {
                        'use server';
                        await archiveProduct(p.id);
                      }}>
                        <button type="submit" className={styles.archiveBtn}>
                          Archive
                        </button>
                      </form>
                    ) : (
                      <form action={async () => {
                        'use server';
                        await unarchiveProduct(p.id);
                      }}>
                        <button type="submit" className={styles.activateBtn}>
                          Activate
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {isNewOpen && <NewProductModal onCloseUrl="/products" />}
    </>
  );
}
