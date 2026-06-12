'use client';

import { updateProjectLifecycle } from '@/actions/projects';
import { useTransition } from 'react';

// Options are the legal next lifecycle states from the project transition
// graph (src/lib/projects.ts).
export default function ProjectLifecycleUpdater({
  projectId,
  currentStatus,
  allowedStatuses,
}: {
  projectId: string;
  currentStatus: string;
  allowedStatuses: string[];
}) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newVal = e.target.value;
    startTransition(() => {
      updateProjectLifecycle(projectId, newVal);
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
