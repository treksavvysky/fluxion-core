'use client';

import { assignIssueToCycle } from '@/actions/cycles';
import { useTransition } from 'react';

export default function CycleAssigner({ 
  issueId, 
  currentCycleId, 
  cycles 
}: { 
  issueId: string, 
  currentCycleId: string | null, 
  cycles: { id: string, name: string }[] 
}) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newVal = e.target.value;
    startTransition(() => {
      assignIssueToCycle(issueId, newVal);
    });
  }

  return (
    <select 
      disabled={isPending}
      value={currentCycleId || 'none'} 
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
      <option value="none" style={{ background: 'var(--app-bg)' }}>No cycle</option>
      {cycles.map(c => (
        <option key={c.id} value={c.id} style={{ background: 'var(--app-bg)' }}>{c.name}</option>
      ))}
    </select>
  );
}
