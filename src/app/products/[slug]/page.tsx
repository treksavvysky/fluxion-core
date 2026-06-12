import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Package, ShieldAlert, GitBranch, Map, Rocket, BookOpen, ScrollText, Activity } from 'lucide-react';
import { getProductBySlug } from '@/actions/products';
import { computeProductMetrics } from '@/lib/metrics';
import { allowedNextProductStatuses, DURABLE_DOC_TYPES } from '@/lib/products';
import ProductStatusUpdater from '@/components/ProductStatusUpdater';
import styles from './product-detail.module.css';

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(decodeURIComponent(slug));
  if (!product) notFound();

  const metrics = await computeProductMetrics(product.id);
  const isArchived = product.status === 'Archived';

  const docSlots = DURABLE_DOC_TYPES.map(slot => ({
    ...slot,
    doc: product.documents.find(d => d.docType === slot.docType) ?? null,
  }));
  const otherDocs = product.documents.filter(d => !DURABLE_DOC_TYPES.some(s => s.docType === d.docType));
  const repoLinks = product.repositories;

  return (
    <div className={styles.container}>
      <div className={styles.breadcrumb}>
        <Link href="/products">Product Portfolio</Link> / {product.slug}
      </div>

      <header className={styles.header}>
        <Package size={22} style={{ color: 'var(--accent)' }} />
        <h1 className={styles.title}>{product.name}</h1>
        <span className={styles.slugPill}>{product.slug}</span>
        <div className={styles.headerActions}>
          <ProductStatusUpdater
            productId={product.id}
            currentStatus={product.status}
            allowedStatuses={allowedNextProductStatuses(product.status)}
          />
        </div>
      </header>
      {isArchived && (
        <div className={styles.readOnlyNote}>
          This product is archived and read-only. Reactivate it to make changes.
        </div>
      )}

      <p className={styles.scope}>{product.description || 'No scope description provided.'}</p>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}><Activity size={12} style={{ verticalAlign: '-2px' }} /> Operational Metrics</h2>
          <div className={styles.metricRow}><span>Open / closed issues</span><span className={styles.metricValue}>{metrics.openIssues} / {metrics.closedIssues}</span></div>
          <div className={styles.metricRow}><span><ShieldAlert size={12} style={{ verticalAlign: '-2px' }} /> Defects (open / closed)</span><span className={styles.metricValue}>{metrics.openDefects} / {metrics.closedDefects}</span></div>
          <div className={styles.metricRow}><span>Technical debt</span><span className={styles.metricValue}>{metrics.techDebtPoints} pts</span></div>
          <div className={styles.metricRow}><span>Roadmap completion</span><span className={styles.metricValue}>{metrics.roadmapCompletion}% across {metrics.totalRoadmaps} roadmap{metrics.totalRoadmaps === 1 ? '' : 's'}</span></div>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}><BookOpen size={12} style={{ verticalAlign: '-2px' }} /> Durable Documentation</h2>
          {docSlots.map(slot => (
            <div key={slot.docType} className={styles.docSlot}>
              <span className={slot.doc ? styles.docFilled : styles.docMissing}>{slot.doc ? '✓' : '✗'}</span>
              {slot.doc ? (
                <Link href={`/docs?slug=${slot.doc.slug}`} className={styles.docLink}>{slot.label}</Link>
              ) : (
                <span>{slot.label}</span>
              )}
              <span className={styles.docMeta}>
                {slot.doc ? `updated ${new Date(slot.doc.updatedAt).toLocaleDateString()}` : 'missing'}
              </span>
            </div>
          ))}
          {otherDocs.length > 0 && (
            <div className={styles.docSlot}>
              <span className={styles.docFilled}>{otherDocs.length}</span>
              <Link href="/docs" className={styles.docLink}>other linked document{otherDocs.length === 1 ? '' : 's'}</Link>
            </div>
          )}
          {repoLinks[0]?.repository.url && (
            <div className={styles.repoSourceNote}>
              Full documentation lives in the repository:{' '}
              <a href={`${repoLinks[0].repository.url}/tree/master/docs`} className={styles.docLink} target="_blank" rel="noreferrer">
                {repoLinks[0].repository.name}/docs
              </a>
            </div>
          )}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}><GitBranch size={12} style={{ verticalAlign: '-2px' }} /> Linked Repositories</h2>
          {repoLinks.length === 0 && <div className={styles.empty}>No repositories linked.</div>}
          {repoLinks.map(link => (
            <div key={link.id} className={styles.listRow}>
              <span className={styles.rowTitle}>
                {link.repository.url
                  ? <a href={link.repository.url} className={styles.docLink} target="_blank" rel="noreferrer">{link.repository.name}</a>
                  : link.repository.name}
              </span>
              <span className={styles.rowMeta}>
                {link.pathFilter ? <span className={styles.pathFilter}>{link.pathFilter}</span> : 'whole repo'}
              </span>
            </div>
          ))}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}><Rocket size={12} style={{ verticalAlign: '-2px' }} /> Projects</h2>
          {product.projects.length === 0 && <div className={styles.empty}>No projects.</div>}
          {product.projects.map(project => (
            <div key={project.id} className={styles.listRow}>
              <span className={styles.rowTitle}>{project.name}</span>
              <span className={styles.rowMeta}>{project.status}</span>
            </div>
          ))}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}><Map size={12} style={{ verticalAlign: '-2px' }} /> Roadmaps</h2>
          {product.roadmaps.length === 0 && <div className={styles.empty}>No roadmaps.</div>}
          {product.roadmaps.map(roadmap => {
            const done = roadmap.issues.filter(i => i.status === 'Done').length;
            return (
              <div key={roadmap.id} className={styles.listRow}>
                <span className={styles.rowTitle}>{roadmap.name}</span>
                <span className={styles.rowMeta}>{roadmap.status} · {done}/{roadmap.issues.length} issues done</span>
              </div>
            );
          })}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}><ScrollText size={12} style={{ verticalAlign: '-2px' }} /> Recent Change Control</h2>
          {product.changeLogs.length === 0 && <div className={styles.empty}>No change logs.</div>}
          {product.changeLogs.map(log => (
            <div key={log.id} className={styles.listRow}>
              <span className={styles.rowTitle} title={log.description}>{log.type}: {log.description}</span>
              <span className={styles.rowMeta}>{new Date(log.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </section>

        <section className={`${styles.panel} ${styles.panelWide}`}>
          <h2 className={styles.panelTitle}><Activity size={12} style={{ verticalAlign: '-2px' }} /> Issues ({product.issues.length})</h2>
          {product.issues.length === 0 && <div className={styles.empty}>No issues in this product.</div>}
          {product.issues.map(issue => (
            <div key={issue.id} className={styles.listRow}>
              <Link href={`/?issueId=${issue.id}`} className={styles.rowId}>{issue.identifier}</Link>
              <span className={styles.rowTitle}>{issue.title}</span>
              <span className={styles.rowMeta}>{issue.priority} · {issue.status}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
