import styles from '@/app/page.module.css';
import { getCycles } from '@/actions/cycles';
import { prisma } from '@/lib/prisma';
import { Target, CalendarDays, Plus } from 'lucide-react';

export default async function CyclesPage() {
  let cycles = await getCycles();
  
  if (cycles.length === 0) {
    await prisma.cycle.create({
      data: {
        name: 'Cycle 41',
        startDate: new Date(),
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      }
    });
    cycles = await getCycles();
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Active Cycles</h1>
          <span className={styles.badge}>{cycles.length}</span>
        </div>
        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.btnPrimary}`}>
            <Plus size={14} /> New Cycle
          </button>
        </div>
      </header>
      
      <div>
        <div className={styles.listHeader}>
          <div className={`${styles.colTitle}`}>Name</div>
          <div className={`${styles.colStatus}`}>Timeline</div>
          <div className={`${styles.colPriority}`}>Issues</div>
        </div>
        
        <div className={styles.issueList}>
          {cycles.map(cycle => (
            <div key={cycle.id} className={styles.issueRow}>
              <div className={`${styles.colTitle} ${styles.issueTitle}`}>
                <Target size={14} color="var(--accent)" style={{ marginRight: 8, verticalAlign: 'middle' }}/>
                {cycle.name}
              </div>
              <div className={styles.colStatus}>
                <span className={styles.statusBadge}>
                   <CalendarDays size={14} />
                   {cycle.startDate.toLocaleDateString()} - {cycle.endDate.toLocaleDateString()}
                </span>
              </div>
              <div className={`${styles.colPriority} ${styles.priorityIcon}`}>{cycle._count.issues} assigned</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
