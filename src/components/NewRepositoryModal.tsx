'use client';

import { useFormStatus } from 'react-dom';
import { X } from 'lucide-react';
import Link from 'next/link';
import { createRepository } from '@/actions/repositories';
import styles from './modal.module.css';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={styles.submitBtn}>
      {pending ? 'Registering...' : 'Register Repository'}
    </button>
  );
}

export default function NewRepositoryModal({ onCloseUrl, products }: { onCloseUrl: string; products: { id: string; name: string }[] }) {
  async function action(formData: FormData) {
    const name = formData.get('name') as string;
    const url = formData.get('url') as string;
    const productId = formData.get('productId') as string;

    try {
      await createRepository({
        name,
        url: url || undefined,
        productId: productId && productId !== 'none' ? productId : undefined,
      });
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to create repository');
    }
  }

  return (
    <div className={styles.backdrop}>
      <div className={styles.modal} style={{ maxWidth: '550px' }}>
        <div className={styles.header}>
          <h2 className={styles.title}>Register Repository</h2>
          <Link href={onCloseUrl} className={styles.closeButton}>
            <X size={16} />
          </Link>
        </div>
        <form action={action}>
          <div className={styles.formContent}>
            <div className={styles.formRow}>
              <label htmlFor="name" className={styles.label}>Repository Name</label>
              <input id="name" name="name" className={styles.input} placeholder="E.g. fluxion-core" required autoFocus />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="url" className={styles.label}>Remote URL (optional — can be backfilled later)</label>
              <input id="url" name="url" className={styles.input} placeholder="https://github.com/owner/repo" />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="productId" className={styles.label}>Owning Product</label>
              <select id="productId" name="productId" className={styles.input} defaultValue="none">
                <option value="none">No product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
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
