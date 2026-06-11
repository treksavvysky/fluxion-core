'use client';
import { useFormStatus } from 'react-dom';
import { X } from 'lucide-react';
import Link from 'next/link';
import { createIssue } from '@/actions/issue';
import styles from './modal.module.css';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={styles.submitBtn}>
      {pending ? 'Saving...' : 'Create Issue'}
    </button>
  );
}

interface Option {
  id: string;
  name: string;
}

export default function NewIssueModal({
  products = [],
  projects = [],
  repositories = [],
}: {
  products?: (Option & { slug: string })[];
  projects?: Option[];
  repositories?: Option[];
}) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>New Issue</h2>
          <Link href="/" className={styles.closeButton}>
            <X size={16} />
          </Link>
        </div>
        <form action={createIssue}>
          <div className={styles.formContent}>
            <div className={styles.formRow}>
              <label htmlFor="title" className={styles.label}>Title</label>
              <input id="title" name="title" className={styles.input} placeholder="Issue title" required autoFocus />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="description" className={styles.label}>Description</label>
              <textarea id="description" name="description" className={styles.textarea} placeholder="Add a description..."></textarea>
            </div>
            <div className={styles.formRow}>
              <label htmlFor="context" className={styles.label}>Context</label>
              <textarea id="context" name="context" className={styles.textarea} placeholder="Why this work exists; what an executor must know... (optional)"></textarea>
            </div>
            <div className={styles.formRow}>
              <label htmlFor="acceptanceCriteria" className={styles.label}>Acceptance Criteria</label>
              <textarea id="acceptanceCriteria" name="acceptanceCriteria" className={styles.textarea} placeholder="Verifiable conditions that define Done... (optional)"></textarea>
            </div>
            <div className={styles.formRow}>
              <label htmlFor="technicalIntent" className={styles.label}>Technical Intent</label>
              <textarea id="technicalIntent" name="technicalIntent" className={styles.textarea} placeholder="Intended approach or constraints... (optional)"></textarea>
            </div>
            <div className={styles.formRow}>
              <label htmlFor="priority" className={styles.label}>Priority</label>
              <select id="priority" name="priority" className={styles.select} defaultValue="Medium">
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </div>
            <div className={styles.formRow}>
              <label htmlFor="productId" className={styles.label}>Product</label>
              <select id="productId" name="productId" className={styles.select} defaultValue="none">
                <option value="none">No product (FLX workspace)</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.slug})</option>
                ))}
              </select>
            </div>
            <div className={styles.formRow}>
              <label htmlFor="projectId" className={styles.label}>Project</label>
              <select id="projectId" name="projectId" className={styles.select} defaultValue="none">
                <option value="none">No project</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.formRow}>
              <label htmlFor="repoId" className={styles.label}>Repository</label>
              <select id="repoId" name="repoId" className={styles.select} defaultValue="none">
                <option value="none">No repository</option>
                {repositories.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.footer}>
            <Link href="/">
              <button type="button" className={styles.cancelBtn}>Cancel</button>
            </Link>
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  );
}
