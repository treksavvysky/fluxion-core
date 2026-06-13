'use client';

import { updateCycleLifecycle } from '@/actions/cycles';
import { useTransition, useState } from 'react';

// Options are the legal next states from the cycle transition graph
// (src/lib/cycles.ts). Activation conflicts (another Active cycle) are
// rejected server-side; the error is surfaced inline.
export default function CycleLifecycleUpdater({
  cycleId,
  currentStatus,
  allowedStatuses,
}: {
  cycleId: string;
  currentStatus: string;
  allowedStatuses: string[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newVal = e.target.value;
    setError(null);
    startTransition(async () => {
      try {
        await updateCycleLifecycle(cycleId, newVal);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <span>
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
      {error && <span style={{ color: '#f59e0b', fontSize: '11px', marginLeft: '8px' }}>{error}</span>}
    </span>
  );
}
