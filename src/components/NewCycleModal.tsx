'use client';
import { useFormStatus } from 'react-dom';
import { X } from 'lucide-react';
import Link from 'next/link';
import { submitCycle } from '@/actions/cycles';
import styles from './modal.module.css';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={styles.submitBtn}>
      {pending ? 'Saving...' : 'Create Cycle'}
    </button>
  );
}

export default function NewCycleModal() {
  return (
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>New Cycle</h2>
          <Link href="/cycles" className={styles.closeButton}>
            <X size={16} />
          </Link>
        </div>
        <form action={submitCycle}>
          <div className={styles.formContent}>
            <div className={styles.formRow}>
              <label htmlFor="name" className={styles.label}>Name</label>
              <input id="name" name="name" className={styles.input} placeholder="Cycle name" required autoFocus />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="goal" className={styles.label}>Goal</label>
              <textarea id="goal" name="goal" className={styles.textarea} placeholder="The primary operational win for this sprint block, in 1-2 sentences..."></textarea>
            </div>
            <div className={styles.formRow}>
              <label htmlFor="startDate" className={styles.label}>Start Date</label>
              <input id="startDate" name="startDate" type="date" className={styles.input} required />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="endDate" className={styles.label}>End Date</label>
              <input id="endDate" name="endDate" type="date" className={styles.input} required />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="capacityPoints" className={styles.label}>Capacity (points)</label>
              <input id="capacityPoints" name="capacityPoints" type="number" min="1" className={styles.input} placeholder="Projected point capacity (High=3, Med=2, Low=1)" />
            </div>
          </div>
          <div className={styles.footer}>
            <Link href="/cycles">
              <button type="button" className={styles.cancelBtn}>Cancel</button>
            </Link>
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  );
}
