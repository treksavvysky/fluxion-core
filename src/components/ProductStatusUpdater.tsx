'use client';

import { updateProductLifecycle } from '@/actions/products';
import { useTransition } from 'react';

// Options are the legal next lifecycle states computed server-side from
// the product transition graph (src/lib/products.ts).
export default function ProductStatusUpdater({
  productId,
  currentStatus,
  allowedStatuses,
}: {
  productId: string;
  currentStatus: string;
  allowedStatuses: string[];
}) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newVal = e.target.value;
    startTransition(() => {
      updateProductLifecycle(productId, newVal);
    });
  };

  return (
    <select
      disabled={isPending}
      value={currentStatus}
      onChange={handleChange}
      style={{
        background: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid var(--border-color)',
        color: 'var(--text-primary)',
        padding: '6px 12px',
        borderRadius: '6px',
        fontSize: '13px',
        opacity: isPending ? 0.5 : 1,
        cursor: isPending ? 'not-allowed' : 'pointer'
      }}
    >
      <option value={currentStatus} style={{ background: 'var(--app-bg)' }}>{currentStatus}</option>
      {allowedStatuses.filter(s => s !== currentStatus).map(s => (
        <option key={s} value={s} style={{ background: 'var(--app-bg)' }}>{s}</option>
      ))}
    </select>
  );
}
