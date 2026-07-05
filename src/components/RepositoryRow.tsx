'use client';

import { useState, useTransition } from 'react';
import { GitBranch, Pencil, Check, X, ExternalLink } from 'lucide-react';
import { updateRepositoryAction } from '@/actions/repositories';
import styles from '@/app/page.module.css';

interface RepoView {
  id: string;
  name: string;
  url: string | null;
  productId: string | null;
  productName: string | null;
  issueCount: number;
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid var(--border-color)',
  color: 'var(--text-primary)',
  padding: '6px 10px',
  borderRadius: '6px',
  fontSize: '13px',
  width: '100%',
};

// One repository row: read view with an edit toggle. Saving funnels through
// updateRepositoryAction -> src/lib/repositories.ts, the same write path the
// update_repository MCP tool uses (FLX-136).
export default function RepositoryRow({ repo, products }: { repo: RepoView; products: { id: string; name: string }[] }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(repo.name);
  const [url, setUrl] = useState(repo.url ?? '');
  const [productId, setProductId] = useState(repo.productId ?? 'none');
  const [isPending, startTransition] = useTransition();

  const cancel = () => {
    setName(repo.name);
    setUrl(repo.url ?? '');
    setProductId(repo.productId ?? 'none');
    setEditing(false);
  };

  const save = () => {
    startTransition(async () => {
      try {
        await updateRepositoryAction(repo.id, {
          name,
          url: url.trim() === '' ? 'none' : url,
          productId,
        });
        setEditing(false);
      } catch (e: unknown) {
        alert(e instanceof Error ? e.message : String(e));
      }
    });
  };

  if (editing) {
    return (
      <div className={styles.issueRow} style={{ opacity: isPending ? 0.5 : 1 }}>
        <div className={styles.colTitle} style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingRight: '16px' }}>
          <GitBranch size={14} color="#f97316" style={{ flexShrink: 0 }} />
          <input aria-label="Repository name" style={{ ...inputStyle, maxWidth: '180px' }} value={name} onChange={(e) => setName(e.target.value)} disabled={isPending} />
          <input aria-label="Repository URL" style={inputStyle} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo (empty to clear)" disabled={isPending} />
        </div>
        <div className={styles.colStatus}>
          <select aria-label="Owning product" style={inputStyle} value={productId} onChange={(e) => setProductId(e.target.value)} disabled={isPending}>
            <option value="none" style={{ background: 'var(--app-bg)' }}>No product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id} style={{ background: 'var(--app-bg)' }}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className={styles.colPriority} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button onClick={save} disabled={isPending} title="Save" style={{ ...inputStyle, width: 'auto', cursor: 'pointer', color: '#4ade80' }}>
            <Check size={14} />
          </button>
          <button onClick={cancel} disabled={isPending} title="Cancel" style={{ ...inputStyle, width: 'auto', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.issueRow}>
      <div className={`${styles.colTitle} ${styles.issueTitle}`} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <GitBranch size={14} color="#f97316" style={{ flexShrink: 0 }} />
        {repo.name}
        {repo.url ? (
          <a href={repo.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 'normal', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            {repo.url} <ExternalLink size={11} />
          </a>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 'normal', fontStyle: 'italic' }}>no remote url</span>
        )}
      </div>
      <div className={styles.colStatus}>
        <span className={styles.statusBadge}>{repo.productName || 'No product'}</span>
      </div>
      <div className={styles.colPriority} style={{ color: 'var(--text-muted)', fontSize: '13px', display: 'flex', gap: '10px', alignItems: 'center' }}>
        {repo.issueCount} issues
        <button onClick={() => setEditing(true)} title="Edit repository" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
          <Pencil size={13} />
        </button>
      </div>
    </div>
  );
}
