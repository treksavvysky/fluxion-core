import styles from '@/app/page.module.css';
import { getRepositories } from '@/actions/repositories';
import { prisma } from '@/lib/prisma';
import { GitBranch, Plus } from 'lucide-react';
import Link from 'next/link';
import RepositoryRow from '@/components/RepositoryRow';
import NewRepositoryModal from '@/components/NewRepositoryModal';

export default async function RepositoriesPage({ searchParams }: { searchParams: Promise<{ new?: string; archived?: string }> }) {
  const params = await searchParams;
  const isNewOpen = params?.new === 'true';
  const showArchived = params?.archived === 'true';

  const [repos, products] = await Promise.all([
    getRepositories(showArchived),
    prisma.product.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const archivedCount = repos.filter((r) => r.archivedAt).length;

  return (
    <>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>
              <GitBranch size={24} style={{ color: '#f97316', marginRight: '8px', verticalAlign: 'middle' }} />
              Repositories
            </h1>
            <span className={styles.badge}>{repos.length}</span>
          </div>
          <div className={styles.actions}>
            <Link
              href={showArchived ? '/repositories' : '/repositories?archived=true'}
              style={{ color: 'var(--text-muted)', fontSize: '13px', alignSelf: 'center', marginRight: '12px' }}
            >
              {showArchived ? `Hide archived${archivedCount ? ` (${archivedCount})` : ''}` : 'Show archived'}
            </Link>
            <Link href="/repositories?new=true">
              <button className={`${styles.btn} ${styles.btnPrimary}`}>
                <Plus size={14} /> New Repository
              </button>
            </Link>
          </div>
        </header>

        <div>
          <div className={styles.listHeader}>
            <div className={styles.colTitle}>Repository & Remote</div>
            <div className={styles.colStatus}>Product Mapping</div>
            <div className={styles.colPriority}>Issues</div>
          </div>

          <div className={styles.issueList}>
            {repos.length === 0 && (
              <div className={styles.issueRow} style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                No repositories registered yet.
              </div>
            )}
            {repos.map((r) => (
              <RepositoryRow
                key={r.id}
                repo={{
                  id: r.id,
                  name: r.name,
                  url: r.url,
                  productId: r.productId,
                  productName: r.product?.name ?? null,
                  issueCount: r._count.issues,
                  archived: r.archivedAt !== null,
                }}
                products={products}
              />
            ))}
          </div>
        </div>
      </div>
      {isNewOpen && <NewRepositoryModal onCloseUrl="/repositories" products={products} />}
    </>
  );
}
