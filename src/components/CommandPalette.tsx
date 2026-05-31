'use client';
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, Target, Map, Plus, BookOpen, ShieldCheck, Cpu, FileText } from 'lucide-react';
import styles from './command-palette.module.css';

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{
    issues: { id: string; identifier: string; title: string }[];
    documents: { id: string; title: string; slug: string; category: string }[];
    changeLogs: { id: string; type: string; description: string }[];
  }>({ issues: [], documents: [], changeLogs: [] });

  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // Debounced search API fetch
  useEffect(() => {
    if (!query.trim()) {
      setResults({ issues: [], documents: [], changeLogs: [] });
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch (err) {
        console.error('Failed to fetch search results:', err);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query]);

  const runCommand = (command: () => void) => {
    setOpen(false);
    setQuery('');
    command();
  };

  if (!open) return null;

  const hasResults =
    results.issues.length > 0 ||
    results.documents.length > 0 ||
    results.changeLogs.length > 0;

  return (
    <div className={styles.overlay} onClick={() => setOpen(false)}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <Command label="Global Command Menu">
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Type a command or search backlog, wikis, logs..."
            className={styles.input}
          />
          <Command.List className={styles.list}>
            {loading && <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>Searching...</div>}
            
            {!loading && query && !hasResults && (
              <Command.Empty className={styles.empty}>No results found.</Command.Empty>
            )}

            {/* DYNAMIC SEARCH RESULTS: ISSUES */}
            {!loading && results.issues.length > 0 && (
              <Command.Group heading="Issues Found">
                {results.issues.map(issue => (
                  <Command.Item
                    key={issue.id}
                    className={styles.item}
                    onSelect={() => runCommand(() => router.push(`/?issueId=${issue.id}`))}
                  >
                    <Layers size={14} className={styles.icon} color="#5e6ad2" />
                    <span style={{ fontFamily: 'monospace', marginRight: '8px', color: 'var(--text-muted)' }}>{issue.identifier}:</span>
                    {issue.title}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* DYNAMIC SEARCH RESULTS: WIKI ARTICLES */}
            {!loading && results.documents.length > 0 && (
              <Command.Group heading="Documentation Found">
                {results.documents.map(doc => (
                  <Command.Item
                    key={doc.id}
                    className={styles.item}
                    onSelect={() => runCommand(() => router.push(`/docs?slug=${doc.slug}`))}
                  >
                    <BookOpen size={14} className={styles.icon} color="#10b981" />
                    <span style={{ fontSize: '11px', textTransform: 'uppercase', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px', marginRight: '8px', color: 'var(--text-muted)' }}>
                      {doc.category}
                    </span>
                    {doc.title}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* DYNAMIC SEARCH RESULTS: CHANGE LOGS */}
            {!loading && results.changeLogs.length > 0 && (
              <Command.Group heading="Change Control Logs Found">
                {results.changeLogs.map(log => (
                  <Command.Item
                    key={log.id}
                    className={styles.item}
                    onSelect={() => runCommand(() => router.push('/change-control'))}
                  >
                    <ShieldCheck size={14} className={styles.icon} color="#f59e0b" />
                    <span style={{ fontWeight: '600', marginRight: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>{log.type}:</span>
                    {log.description.substring(0, 50)}...
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* STATIC COMMAND GROUPS */}
            <Command.Group heading="Navigation">
              <Command.Item className={styles.item} onSelect={() => runCommand(() => router.push('/'))}>
                <Layers size={14} className={styles.icon} /> Issues Backlog
              </Command.Item>
              <Command.Item className={styles.item} onSelect={() => runCommand(() => router.push('/cycles'))}>
                <Target size={14} className={styles.icon} /> Active Cycles
              </Command.Item>
              <Command.Item className={styles.item} onSelect={() => runCommand(() => router.push('/roadmaps'))}>
                <Map size={14} className={styles.icon} /> Roadmaps
              </Command.Item>
              <Command.Item className={styles.item} onSelect={() => runCommand(() => router.push('/change-control'))}>
                <ShieldCheck size={14} className={styles.icon} /> Change Control
              </Command.Item>
              <Command.Item className={styles.item} onSelect={() => runCommand(() => router.push('/docs'))}>
                <BookOpen size={14} className={styles.icon} /> Documentation
              </Command.Item>
              <Command.Item className={styles.item} onSelect={() => runCommand(() => router.push('/automations'))}>
                <Cpu size={14} className={styles.icon} /> Automations
              </Command.Item>
            </Command.Group>

            <Command.Group heading="Actions">
              <Command.Item className={styles.item} onSelect={() => runCommand(() => router.push('/?new=true'))}>
                <Plus size={14} className={styles.icon} /> Create New Issue
              </Command.Item>
              <Command.Item className={styles.item} onSelect={() => runCommand(() => router.push('/docs?new=true'))}>
                <Plus size={14} className={styles.icon} /> Publish New Document
              </Command.Item>
              <Command.Item className={styles.item} onSelect={() => runCommand(() => router.push('/automations?new=true'))}>
                <Plus size={14} className={styles.icon} /> Deploy Automation Rule
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
