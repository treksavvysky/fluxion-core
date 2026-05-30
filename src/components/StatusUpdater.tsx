'use client';

import { updateIssueStatus } from '@/actions/issue';
import { useTransition } from 'react';

export default function StatusUpdater({ issueId, currentStatus }: { issueId: string, currentStatus: string }) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newVal = e.target.value;
    startTransition(() => {
      updateIssueStatus(issueId, newVal);
    });
  }

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
      <option value="Todo" style={{ background: 'var(--app-bg)' }}>Todo</option>
      <option value="In Progress" style={{ background: 'var(--app-bg)' }}>In Progress</option>
      <option value="Done" style={{ background: 'var(--app-bg)' }}>Done</option>
      <option value="Backlog" style={{ background: 'var(--app-bg)' }}>Backlog</option>
    </select>
  );
}
