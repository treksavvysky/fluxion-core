import styles from './page.module.css';
import { Filter, SortAsc, Plus, Circle, CircleDashed, CheckCircle2 } from 'lucide-react';
import { getIssues } from '@/actions/issue';
import NewIssueModal from '@/components/NewIssueModal';
import IssuePeek from '@/components/IssuePeek';
import Link from 'next/link';

function getStatusIcon(status: string) {
  switch (status) {
    case 'Done': return <CheckCircle2 size={14} color="#3fb950" />;
    case 'In Progress': return <CircleDashed size={14} color="#5e6ad2" />;
    case 'Todo':
    default: return <Circle size={14} color="var(--text-muted)" />;
  }
}

export default async function Home({ searchParams }: { searchParams: Promise<{ new?: string, issueId?: string }> }) {
  const params = await searchParams;
  const isNewIssueOpen = params?.new === 'true';
  const openIssueId = params?.issueId;

  const issues = await getIssues();

  return (
    <>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>All Issues</h1>
            <span className={styles.badge}>{issues.length}</span>
          </div>
          <div className={styles.actions}>
            <button className={`${styles.btn} ${styles.btnSecondary}`}>
              <Filter size={14} /> Filter
            </button>
            <button className={`${styles.btn} ${styles.btnSecondary}`}>
              <SortAsc size={14} /> Sort
            </button>
            <Link href="/?new=true" style={{ textDecoration: 'none' }}>
              <button className={`${styles.btn} ${styles.btnPrimary}`}>
                <Plus size={14} /> New Issue
              </button>
            </Link>
          </div>
        </header>

        <div>
          <div className={styles.listHeader}>
            <div className={`${styles.colId}`}>ID</div>
            <div className={`${styles.colStatus}`}>Status</div>
            <div className={`${styles.colTitle}`}>Title</div>
            <div className={`${styles.colPriority}`}>Priority</div>
          </div>

          <div className={styles.issueList}>
            {issues.map(issue => (
              <Link href={`/?issueId=${issue.id}`} key={issue.id} style={{ textDecoration: 'none', display: 'block' }}>
                <div className={styles.issueRow}>
                  <div className={`${styles.colId} ${styles.issueId}`}>{issue.identifier}</div>
                  <div className={styles.colStatus}>
                    <span className={styles.statusBadge}>
                      {getStatusIcon(issue.status)}
                      {issue.status}
                    </span>
                  </div>
                  <div className={`${styles.colTitle} ${styles.issueTitle}`}>{issue.title}</div>
                  <div className={`${styles.colPriority} ${styles.priorityIcon}`}>{issue.priority}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
      
      {isNewIssueOpen && <NewIssueModal />}
      {openIssueId && <IssuePeek issueId={openIssueId} />}
    </>
  );
}
