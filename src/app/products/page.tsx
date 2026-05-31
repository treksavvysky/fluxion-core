import styles from './products.module.css';
import { getProducts, archiveProduct, unarchiveProduct } from '@/actions/products';
import { prisma } from '@/lib/prisma';
import { Package, Plus } from 'lucide-react';
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
            <div>Assets & Issues</div>
            <div style={{ textAlign: 'right' }}>Actions</div>
          </div>

          <div className={styles.issueList} style={{ display: 'flex', flexDirection: 'column' }}>
            {products.map(p => (
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
                  {p._count.repos} repos • {p._count.projects} projects • {p._count.issues} issues
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
            ))}
          </div>
        </div>
      </div>

      {isNewOpen && <NewProductModal onCloseUrl="/products" />}
    </>
  );
}
