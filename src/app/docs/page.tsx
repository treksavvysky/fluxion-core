import styles from './docs.module.css';
import { BookOpen, Plus, Folder, Calendar, Package, GitBranch, LayoutGrid, FileText } from 'lucide-react';
import { getDocuments, getDocumentBySlug } from '@/actions/document';
import { prisma } from '@/lib/prisma';
import NewDocumentModal from '@/components/NewDocumentModal';
import Link from 'next/link';
import React from 'react';

// Line-by-line secure TSX Markdown compiler
function renderMarkdownContent(content: string) {
  const lines = content.split('\n');
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = '';

  const elements: React.ReactNode[] = [];

  lines.forEach((line, idx) => {
    // Code block detection
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        inCodeBlock = false;
        const codeText = codeLines.join('\n');
        codeLines = [];
        const currentLang = codeLang;
        elements.push(
          <pre
            key={`code-${idx}`}
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              padding: '14px',
              fontFamily: 'monospace',
              fontSize: '13px',
              lineHeight: '1.5',
              overflowX: 'auto',
              color: 'var(--text-primary)',
              margin: '16px 0',
            }}
          >
            {currentLang && (
              <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 'bold', marginBottom: '8px' }}>
                {currentLang}
              </div>
            )}
            <code>{codeText}</code>
          </pre>
        );
      } else {
        inCodeBlock = true;
        codeLang = line.replace('```', '').trim();
      }
      return;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }

    // Headers
    if (line.startsWith('# ')) {
      elements.push(
        <h1
          key={idx}
          style={{
            fontSize: '22px',
            fontWeight: '700',
            color: 'var(--text-primary)',
            marginTop: '24px',
            marginBottom: '16px',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '8px',
          }}
        >
          {line.replace('# ', '')}
        </h1>
      );
      return;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={idx} style={{ fontSize: '17px', fontWeight: '600', color: 'var(--text-primary)', marginTop: '20px', marginBottom: '12px' }}>
          {line.replace('## ', '')}
        </h2>
      );
      return;
    }
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={idx} style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginTop: '16px', marginBottom: '8px' }}>
          {line.replace('### ', '')}
        </h3>
      );
      return;
    }

    // Blockquote / Callout
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote
          key={idx}
          style={{
            borderLeft: '3px solid var(--accent)',
            paddingLeft: '14px',
            color: 'var(--text-muted)',
            fontStyle: 'italic',
            margin: '16px 0',
          }}
        >
          {line.replace('> ', '')}
        </blockquote>
      );
      return;
    }

    // List items
    if (line.startsWith('* ') || line.startsWith('- ')) {
      elements.push(
        <li key={idx} style={{ marginLeft: '20px', color: 'var(--text-primary)', marginBottom: '6px', fontSize: '14px' }}>
          {renderInlineText(line.substring(2))}
        </li>
      );
      return;
    }

    // Empty space
    if (!line.trim()) {
      elements.push(<div key={idx} style={{ height: '12px' }} />);
      return;
    }

    // Standard paragraph
    elements.push(
      <p key={idx} style={{ fontSize: '14.5px', color: 'var(--text-primary)', lineHeight: '1.6', marginBottom: '12px' }}>
        {renderInlineText(line)}
      </p>
    );
  });

  return elements;
}

function renderInlineText(text: string) {
  const parts = text.split(/(\*\*|`)/g);
  let isBold = false;
  let isCode = false;

  return parts.map((part, i) => {
    if (part === '**') {
      isBold = !isBold;
      return null;
    }
    if (part === '`') {
      isCode = !isCode;
      return null;
    }

    if (isBold) {
      return <strong key={i} style={{ fontWeight: '600', color: 'white' }}>{part}</strong>;
    }
    if (isCode) {
      return (
        <code
          key={i}
          style={{
            background: 'rgba(255,255,255,0.06)',
            padding: '2px 6px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '13px',
            color: 'var(--text-primary)',
          }}
        >
          {part}
        </code>
      );
    }
    return part;
  });
}

export default async function DocsPage({ searchParams }: { searchParams: Promise<{ slug?: string; new?: string }> }) {
  const params = await searchParams;
  const isNewOpen = params?.new === 'true';
  const activeSlug = params?.slug;

  const docs = await getDocuments();

  // Determine active document
  let activeDoc = null;
  if (docs.length > 0) {
    const slugToFind = activeSlug || docs[0].slug;
    activeDoc = await getDocumentBySlug(slugToFind);
  }

  // Group documents by category
  const categories: Record<string, typeof docs> = {};
  docs.forEach(doc => {
    if (!categories[doc.category]) {
      categories[doc.category] = [];
    }
    categories[doc.category].push(doc);
  });

  // Query databases for relations scope select options
  const products = await prisma.product.findMany({ select: { id: true, name: true } });
  const repos = await prisma.repository.findMany({ select: { id: true, name: true } });
  const projects = await prisma.project.findMany({ select: { id: true, name: true } });

  const onCloseUrl = activeDoc ? `/docs?slug=${activeDoc.slug}` : '/docs';

  return (
    <>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>
              <BookOpen size={24} style={{ color: 'var(--accent)', marginRight: '8px' }} />
              Documentation Hub
            </h1>
            <span className={styles.badge}>
              Stateless codebase knowledge management, technical boundaries, and AI agent context injection documents.
            </span>
          </div>
          <div>
            <Link href="/docs?new=true">
              <button className={styles.newBtn}>
                <Plus size={14} /> New Document
              </button>
            </Link>
          </div>
        </header>

        {docs.length === 0 ? (
          <div className={styles.emptyState}>
            <FileText size={48} style={{ color: 'var(--text-muted)' }} />
            <h3 className={styles.emptyTitle}>No Documentation Yet</h3>
            <p className={styles.emptyText}>
              Publish architecture guidelines or schema wikis to kickstart the collective memory of the product.
            </p>
            <Link href="/docs?new=true" style={{ marginTop: '16px', display: 'inline-block' }}>
              <button className={styles.newBtn}>
                <Plus size={14} /> Publish First Doc
              </button>
            </Link>
          </div>
        ) : (
          <div className={styles.docsGrid}>
            
            {/* LEFT SIDEBAR: DOCUMENT SELECTIONS BY CATEGORY */}
            <aside className={styles.sidebar}>
              {Object.keys(categories).map(catName => (
                <div key={catName} className={styles.categoryBlock}>
                  <div className={styles.categoryTitle}>{catName}</div>
                  {categories[catName].map(docItem => (
                    <Link
                      key={docItem.id}
                      href={`/docs?slug=${docItem.slug}`}
                      className={`${styles.docLink} ${activeDoc?.slug === docItem.slug ? styles.docLinkActive : ''}`}
                    >
                      {docItem.title}
                    </Link>
                  ))}
                </div>
              ))}
            </aside>

            {/* RIGHT PANEL: ARTICLE COMPILER */}
            {activeDoc ? (
              <article className={styles.articleCard}>
                <header className={styles.articleHeader}>
                  <h2 className={styles.articleTitle}>{activeDoc.title}</h2>
                  <div className={styles.articleMeta}>
                    <span className={styles.categoryBadge}>{activeDoc.category}</span>
                    <div className={styles.metaItem}>
                      <Calendar size={12} />
                      <span>
                        Updated {new Date(activeDoc.updatedAt).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>
                </header>

                <div className={styles.articleContent}>
                  {renderMarkdownContent(activeDoc.content)}
                </div>

                {(activeDoc.product || activeDoc.repo || activeDoc.project) && (
                  <div className={styles.scopes}>
                    {activeDoc.product && (
                      <span className={`${styles.scopeTag} ${styles.productScope}`}>
                        <Package size={10} style={{ marginRight: '4px' }} />
                        <strong>Product:</strong> {activeDoc.product.name}
                      </span>
                    )}
                    {activeDoc.repo && (
                      <span className={`${styles.scopeTag} ${styles.repoScope}`}>
                        <GitBranch size={10} style={{ marginRight: '4px' }} />
                        <strong>Repository:</strong> {activeDoc.repo.name}
                      </span>
                    )}
                    {activeDoc.project && (
                      <span className={`${styles.scopeTag} ${styles.projectScope}`}>
                        <LayoutGrid size={10} style={{ marginRight: '4px' }} />
                        <strong>Project:</strong> {activeDoc.project.name}
                      </span>
                    )}
                  </div>
                )}
              </article>
            ) : (
              <div className={styles.articleCard} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  <FileText size={48} style={{ margin: '0 auto 16px auto', opacity: 0.5 }} />
                  <p>Select a document from the sidebar navigation</p>
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      {isNewOpen && (
        <NewDocumentModal
          products={products}
          repos={repos}
          projects={projects}
          onCloseUrl={onCloseUrl}
        />
      )}
    </>
  );
}
