'use client';

import { useFormStatus } from 'react-dom';
import { X } from 'lucide-react';
import Link from 'next/link';
import { submitRule } from '@/actions/automation';
import styles from './modal.module.css';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={styles.submitBtn}>
      {pending ? 'Saving...' : 'Deploy Rule'}
    </button>
  );
}

export default function NewRuleModal({ onCloseUrl }: { onCloseUrl: string }) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.modal} style={{ maxWidth: '600px' }}>
        <div className={styles.header}>
          <h2 className={styles.title}>Deploy DevOps Automation Rule</h2>
          <Link href={onCloseUrl} className={styles.closeButton}>
            <X size={16} />
          </Link>
        </div>
        <form action={submitRule}>
          <div className={styles.formContent}>
            <div className={styles.formRow}>
              <label htmlFor="name" className={styles.label}>Rule Name</label>
              <input id="name" name="name" className={styles.input} placeholder="E.g. Staging Cluster Outage Recovery" required autoFocus />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className={styles.formRow}>
                <label htmlFor="trigger" className={styles.label}>Trigger Event</label>
                <select id="trigger" name="trigger" className={styles.select} defaultValue="BUILD_FAILURE">
                  <option value="BUILD_FAILURE">BUILD_FAILURE</option>
                  <option value="HEALTH_DEGRADED">HEALTH_DEGRADED</option>
                  <option value="DEPLOYMENT_SUCCESS">DEPLOYMENT_SUCCESS</option>
                  <option value="PR_OPENED">PR_OPENED</option>
                </select>
              </div>
              <div className={styles.formRow}>
                <label htmlFor="action" className={styles.label}>Action Handler</label>
                <select id="action" name="action" className={styles.select} defaultValue="TRIGGER_SELF_HEALING">
                  <option value="TRIGGER_SELF_HEALING">TRIGGER_SELF_HEALING</option>
                  <option value="AUTO_DELEGATE">AUTO_DELEGATE</option>
                  <option value="LOG_AUDIT">LOG_AUDIT</option>
                </select>
              </div>
            </div>

            <div className={styles.formRow}>
              <label htmlFor="condition" className={styles.label}>Conditional Filter (Optional Expression)</label>
              <input id="condition" name="condition" className={styles.input} placeholder="E.g. branch == 'staging'" />
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
