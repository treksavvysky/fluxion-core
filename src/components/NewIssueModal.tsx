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

export default function NewIssueModal() {
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
              <label htmlFor="priority" className={styles.label}>Priority</label>
              <select id="priority" name="priority" className={styles.select} defaultValue="Medium">
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
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
