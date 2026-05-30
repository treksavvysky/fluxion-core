import styles from '@/app/page.module.css';
import { getRoadmaps } from '@/actions/roadmaps';
import { prisma } from '@/lib/prisma';
import { Map, Plus } from 'lucide-react';

export default async function RoadmapsPage() {
  let roadmaps = await getRoadmaps();
  
  if (roadmaps.length === 0) {
    await prisma.roadmap.create({
      data: {
        name: 'Q3 Product Expansion',
      }
    });
    roadmaps = await getRoadmaps();
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Roadmaps</h1>
          <span className={styles.badge}>{roadmaps.length}</span>
        </div>
        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.btnPrimary}`}>
            <Plus size={14} /> New Roadmap
          </button>
        </div>
      </header>
      
      <div>
        <div className={styles.listHeader}>
          <div className={`${styles.colTitle}`}>Initiative</div>
          <div className={`${styles.colStatus}`}>Status</div>
          <div className={`${styles.colPriority}`}>Issues</div>
        </div>
        
        <div className={styles.issueList}>
          {roadmaps.map(rm => (
            <div key={rm.id} className={styles.issueRow}>
              <div className={`${styles.colTitle} ${styles.issueTitle}`}>
                <Map size={14} color="#5e6ad2" style={{ marginRight: 8, verticalAlign: 'middle' }}/>
                {rm.name}
              </div>
              <div className={styles.colStatus}>
                <span className={styles.statusBadge}>
                   {rm.status}
                </span>
              </div>
              <div className={`${styles.colPriority} ${styles.priorityIcon}`}>{rm._count.issues} tracked</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
