'use client';
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, Target, Map, Plus } from 'lucide-react';
import styles from './command-palette.module.css';

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
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

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={() => setOpen(false)}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <Command label="Global Command Menu">
          <Command.Input placeholder="Type a command or search..." className={styles.input} />
          <Command.List className={styles.list}>
            <Command.Empty className={styles.empty}>No results found.</Command.Empty>

        <Command.Group heading="Navigation">
          <Command.Item className={styles.item} onSelect={() => runCommand(() => router.push('/'))}>
            <Layers size={14} className={styles.icon} /> Issues
          </Command.Item>
          <Command.Item className={styles.item} onSelect={() => runCommand(() => router.push('/cycles'))}>
            <Target size={14} className={styles.icon} /> Active Cycles
          </Command.Item>
          <Command.Item className={styles.item} onSelect={() => runCommand(() => router.push('/roadmaps'))}>
            <Map size={14} className={styles.icon} /> Roadmaps
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Actions">
          <Command.Item className={styles.item} onSelect={() => runCommand(() => router.push('/?new=true'))}>
            <Plus size={14} className={styles.icon} /> Create New Issue
          </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
      </div>
    </div>
  );
}
