'use client';
import { useFormStatus } from 'react-dom';
import { X } from 'lucide-react';
import Link from 'next/link';
import { submitProject } from '@/actions/projects';
import styles from './modal.module.css';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={styles.submitBtn}>
      {pending ? 'Saving...' : 'Create Project'}
    </button>
  );
}

export default function NewProjectModal({
  products = [],
}: {
  products?: { id: string; name: string; slug: string }[];
}) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>New Project</h2>
          <Link href="/projects" className={styles.closeButton}>
            <X size={16} />
          </Link>
        </div>
        <form action={submitProject}>
          <div className={styles.formContent}>
            <div className={styles.formRow}>
              <label htmlFor="name" className={styles.label}>Name</label>
              <input id="name" name="name" className={styles.input} placeholder="Project name" required autoFocus />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="description" className={styles.label}>Description</label>
              <textarea id="description" name="description" className={styles.textarea} placeholder="The outcome this project exists to ship..."></textarea>
            </div>
            <div className={styles.formRow}>
              <label htmlFor="productId" className={styles.label}>Product</label>
              <select id="productId" name="productId" className={styles.select} defaultValue="none">
                <option value="none">No product</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.slug})</option>
                ))}
              </select>
            </div>
            <div className={styles.formRow}>
              <label htmlFor="startDate" className={styles.label}>Start Date</label>
              <input id="startDate" name="startDate" type="date" className={styles.input} />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="endDate" className={styles.label}>Target End Date</label>
              <input id="endDate" name="endDate" type="date" className={styles.input} />
            </div>
          </div>
          <div className={styles.footer}>
            <Link href="/projects">
              <button type="button" className={styles.cancelBtn}>Cancel</button>
            </Link>
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  );
}
