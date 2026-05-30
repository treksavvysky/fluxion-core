'use client';

import styles from './sidebar.module.css';
import { Layers, CheckCircle2, Map, Users, Settings, Plus, Search } from 'lucide-react';
import Link from 'next/link';

export default function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.brandIcon}>
          <Layers size={12} />
        </div>
        <span>Fluxion Workspace</span>
      </div>

      <div className={styles.navGroup}>
        <Link href="/?new=true" className={styles.navItem} style={{ textDecoration: 'none' }}>
          <Plus size={16} className={styles.navItemIcon} />
          New Issue
          <div className={styles.shortcut}>C</div>
        </Link>
        <div className={styles.navItem}>
          <Search size={16} className={styles.navItemIcon} />
          Search
          <div className={styles.shortcut}>Cmd K</div>
        </div>
      </div>

      <div className={styles.navGroup}>
        <div className={styles.navGroupTitle}>Your Work</div>
        <Link href="/" className={`${styles.navItem} ${styles.active}`} style={{ textDecoration: 'none' }}>
          <CheckCircle2 size={16} className={styles.navItemIcon} />
          Issues
        </Link>
        <Link href="/cycles" className={styles.navItem} style={{ textDecoration: 'none' }}>
          <Layers size={16} className={styles.navItemIcon} />
          Active Cycle
        </Link>
      </div>

      <div className={styles.navGroup}>
        <div className={styles.navGroupTitle}>Planning</div>
        <Link href="/roadmaps" className={styles.navItem} style={{ textDecoration: 'none' }}>
          <Map size={16} className={styles.navItemIcon} />
          Roadmaps
        </Link>
        <div className={styles.navItem}>
          <Users size={16} className={styles.navItemIcon} />
          Teams
        </div>
      </div>

      <div style={{ marginTop: 'auto' }}>
        <div className={styles.navItem}>
          <Settings size={16} className={styles.navItemIcon} />
          Settings
        </div>
      </div>
    </aside>
  );
}
