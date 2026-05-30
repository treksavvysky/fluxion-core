'use client';

import { useFormStatus } from 'react-dom';
import { X } from 'lucide-react';
import Link from 'next/link';
import { submitDocument } from '@/actions/document';
import styles from './modal.module.css';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={styles.submitBtn}>
      {pending ? 'Publishing...' : 'Publish Document'}
    </button>
  );
}

interface NewDocumentModalProps {
  products: { id: string; name: string }[];
  repos: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  onCloseUrl: string;
}

export default function NewDocumentModal({ products, repos, projects, onCloseUrl }: NewDocumentModalProps) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.modal} style={{ maxWidth: '750px' }}>
        <div className={styles.header}>
          <h2 className={styles.title}>Publish New Technical Article</h2>
          <Link href={onCloseUrl} className={styles.closeButton}>
            <X size={16} />
          </Link>
        </div>
        <form action={submitDocument}>
          <div className={styles.formContent}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
              <div className={styles.formRow}>
                <label htmlFor="title" className={styles.label}>Article Title</label>
                <input id="title" name="title" className={styles.input} placeholder="E.g. Neon Connection Pool Tuning" required autoFocus />
              </div>
              <div className={styles.formRow}>
                <label htmlFor="category" className={styles.label}>Category</label>
                <select id="category" name="category" className={styles.select} defaultValue="General">
                  <option value="Architecture">Architecture</option>
                  <option value="Schema">Schema</option>
                  <option value="API">API</option>
                  <option value="Guides">Guides</option>
                  <option value="General">General</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <div className={styles.formRow}>
                <label htmlFor="productId" className={styles.label}>Product Scope</label>
                <select id="productId" name="productId" className={styles.select} defaultValue="none">
                  <option value="none">None (Global System)</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formRow}>
                <label htmlFor="repoId" className={styles.label}>Repository</label>
                <select id="repoId" name="repoId" className={styles.select} defaultValue="none">
                  <option value="none">None</option>
                  {repos.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formRow}>
                <label htmlFor="projectId" className={styles.label}>Project Scope</label>
                <select id="projectId" name="projectId" className={styles.select} defaultValue="none">
                  <option value="none">None</option>
                  {projects.map(pr => (
                    <option key={pr.id} value={pr.id}>{pr.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.formRow}>
              <label htmlFor="content" className={styles.label}>Markdown Content</label>
              <textarea id="content" name="content" className={styles.textarea} style={{ minHeight: '280px', fontFamily: 'monospace' }} placeholder="# My Article Title&#10;&#10;Write clean Markdown content here...&#10;&#10;## Section Title&#10;* Lists&#10;* Bullets" required></textarea>
            </div>
          </div>
          <div className={styles.footer}>
            <Link href={onCloseUrl}>
              <button type="button" className={styles.cancelBtn}>Cancel</button>
            </Link>
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  );
}
