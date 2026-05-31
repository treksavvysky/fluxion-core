'use client';

import { useFormStatus } from 'react-dom';
import { X } from 'lucide-react';
import Link from 'next/link';
import { createProduct } from '@/actions/products';
import styles from './modal.module.css';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={styles.submitBtn}>
      {pending ? 'Creating...' : 'Create Product'}
    </button>
  );
}

export default function NewProductModal({ onCloseUrl }: { onCloseUrl: string }) {
  async function action(formData: FormData) {
    const name = formData.get('name') as string;
    const slug = formData.get('slug') as string;
    const description = formData.get('description') as string;

    try {
      await createProduct({ name, slug, description });
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      alert(errMsg || 'Failed to create product');
    }
  }

  return (
    <div className={styles.backdrop}>
      <div className={styles.modal} style={{ maxWidth: '550px' }}>
        <div className={styles.header}>
          <h2 className={styles.title}>Provision New Product Container</h2>
          <Link href={onCloseUrl} className={styles.closeButton}>
            <X size={16} />
          </Link>
        </div>
        <form action={action}>
          <div className={styles.formContent}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
              <div className={styles.formRow}>
                <label htmlFor="name" className={styles.label}>Product Name</label>
                <input id="name" name="name" className={styles.input} placeholder="E.g. Auth Gateway API" required autoFocus />
              </div>
              <div className={styles.formRow}>
                <label htmlFor="slug" className={styles.label}>Slug ID</label>
                <input id="slug" name="slug" className={styles.input} style={{ textTransform: 'uppercase' }} placeholder="AUTH" required maxLength={10} minLength={2} />
              </div>
            </div>

            <div className={styles.formRow}>
              <label htmlFor="description" className={styles.label}>Product Scope Description</label>
              <textarea id="description" name="description" className={styles.textarea} placeholder="Describe the domain boundary of this product container..."></textarea>
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
