'use client';

import { assignIssueDetails } from '@/actions/issue';
import { useTransition } from 'react';

export default function ProjectAssigner({ 
  issueId, 
  currentProjectId, 
  projects 
}: { 
  issueId: string, 
  currentProjectId: string | null, 
  projects: { id: string, name: string }[] 
}) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newVal = e.target.value;
    startTransition(async () => {
      await assignIssueDetails(issueId, { projectId: newVal });
    });
  }

  return (
    <select 
      disabled={isPending}
      value={currentProjectId || 'none'} 
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
      <option value="none" style={{ background: 'var(--app-bg)' }}>No project</option>
      {projects.map(p => (
        <option key={p.id} value={p.id} style={{ background: 'var(--app-bg)' }}>{p.name}</option>
      ))}
    </select>
  );
}
