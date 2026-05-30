'use client';

import { useFormStatus } from 'react-dom';
import { X } from 'lucide-react';
import Link from 'next/link';
import { submitChangeLog } from '@/actions/changelog';
import styles from './modal.module.css';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={styles.submitBtn}>
      {pending ? 'Registering...' : 'Register Change'}
    </button>
  );
}

interface NewChangeLogModalProps {
  products: { id: string; name: string }[];
  repos: { id: string; name: string }[];
  issues: { id: string; title: string; identifier: string }[];
}

export default function NewChangeLogModal({ products, repos, issues }: NewChangeLogModalProps) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.modal} style={{ maxWidth: '650px' }}>
        <div className={styles.header}>
          <h2 className={styles.title}>Register Change Control Event</h2>
          <Link href="/change-control" className={styles.closeButton}>
            <X size={16} />
          </Link>
        </div>
        <form action={submitChangeLog}>
          <div className={styles.formContent}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className={styles.formRow}>
                <label htmlFor="type" className={styles.label}>Change Type</label>
                <select id="type" name="type" className={styles.select} defaultValue="Deployment">
                  <option value="Deployment">Deployment</option>
                  <option value="Migration">Migration</option>
                  <option value="API Release">API Release</option>
                  <option value="Config Change">Config Change</option>
                </select>
              </div>
              <div className={styles.formRow}>
                <label htmlFor="approvedBy" className={styles.label}>Approved By</label>
                <input id="approvedBy" name="approvedBy" className={styles.input} placeholder="E.g. George Loudon" required defaultValue="George Loudon" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className={styles.formRow}>
                <label htmlFor="implementedBy" className={styles.label}>Implemented By</label>
                <input id="implementedBy" name="implementedBy" className={styles.input} placeholder="E.g. Antigravity" required defaultValue="Antigravity" />
              </div>
              <div className={styles.formRow}>
                <label htmlFor="productId" className={styles.label}>Product Scope</label>
                <select id="productId" name="productId" className={styles.select} defaultValue="none">
                  <option value="none">None (Global System)</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
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
                <label htmlFor="issueId" className={styles.label}>Associated Issue</label>
                <select id="issueId" name="issueId" className={styles.select} defaultValue="none">
                  <option value="none">None</option>
                  {issues.map(i => (
                    <option key={i.id} value={i.id}>{i.identifier}: {i.title.substring(0, 30)}...</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.formRow}>
              <label htmlFor="description" className={styles.label}>Change Description</label>
              <textarea id="description" name="description" className={styles.textarea} placeholder="Detailed description of what change was made..." required autoFocus></textarea>
            </div>

            <div className={styles.formRow}>
              <label htmlFor="reason" className={styles.label}>Change Rationale (Why?)</label>
              <textarea id="reason" name="reason" className={styles.textarea} style={{ minHeight: '60px' }} placeholder="Why was this change required? / Audit trail notes..."></textarea>
            </div>
          </div>
          <div className={styles.footer}>
            <Link href="/change-control">
              <button type="button" className={styles.cancelBtn}>Cancel</button>
            </Link>
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  );
}
