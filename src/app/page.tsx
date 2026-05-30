import styles from './page.module.css';
import { Circle, CircleDashed, CheckCircle2, Server, Terminal, Activity, GitPullRequest, Plus } from 'lucide-react';
import { getIssues } from '@/actions/issue';
import { getBuilds, getEnvironments, getActivityLogs } from '@/actions/telemetry';
import NewIssueModal from '@/components/NewIssueModal';
import IssuePeek from '@/components/IssuePeek';
import Link from 'next/link';

function getStatusIcon(status: string) {
  switch (status) {
    case 'Done': return <CheckCircle2 size={14} color="#3fb950" />;
    case 'In Progress': return <CircleDashed size={14} color="#5e6ad2" style={{ animation: 'spin 2s linear infinite' }} />;
    case 'Todo':
    default: return <Circle size={14} color="var(--text-muted)" />;
  }
}

export default async function Home({ searchParams }: { searchParams: Promise<{ new?: string, issueId?: string }> }) {
  const params = await searchParams;
  const isNewIssueOpen = params?.new === 'true';
  const openIssueId = params?.issueId;

  // Query backlog and real-time operations telemetry
  const issues = await getIssues();
  const envs = await getEnvironments();
  const builds = await getBuilds();
  const logs = await getActivityLogs();

  return (
    <>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Command Center</h1>
          <span className={styles.badge}>Real-time system telemetry and AI-collaborative backlog</span>
        </header>

        <div className={styles.dashboardGrid}>
          
          {/* LEFT COLUMN: SYSTEM TELEMETRY */}
          <section className={styles.telemetryPane}>
            <div className={styles.paneHeader}>
              <Server size={14} className={styles.paneIcon} />
              <h2>Environments</h2>
            </div>
            <div className={styles.envList}>
              {envs.map(env => (
                <div key={env.id} className={styles.envCard}>
                  <div className={styles.envMain}>
                    <span className={`${styles.statusDot} ${styles[env.status.toLowerCase()]}`}></span>
                    <span className={styles.envName}>{env.name}</span>
                  </div>
                  <span className={styles.envVersion}>{env.version}</span>
                </div>
              ))}
            </div>

            <div className={styles.paneHeader} style={{ marginTop: '32px' }}>
              <Terminal size={14} className={styles.paneIcon} />
              <h2>Active Builds</h2>
            </div>
            <div className={styles.buildList}>
              {builds.map(build => (
                <div key={build.id} className={styles.buildCard}>
                  <div className={styles.buildMeta}>
                    <span className={`${styles.buildBadge} ${styles[build.status.toLowerCase()]}`}>{build.status}</span>
                    <span className={styles.buildHash}>{build.commitHash}</span>
                  </div>
                  <div className={styles.buildMsg} title={build.commitMsg || ''}>{build.commitMsg}</div>
                  <div className={styles.buildBranch}>{build.repo?.name || 'fluxion-core'} • {build.branch}</div>
                </div>
              ))}
            </div>
          </section>

          {/* CENTER COLUMN: ISSUES BACKLOG */}
          <section className={styles.backlogPane}>
            <div className={styles.paneHeader}>
              <Activity size={14} className={styles.paneIcon} />
              <h2>Backlog ({issues.length})</h2>
              <Link href="/?new=true" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
                <button className={styles.iconBtn} title="Create New Issue">
                  <Plus size={14} />
                </button>
              </Link>
            </div>

            <div className={styles.issueList}>
              {issues.map(issue => (
                <Link href={`/?issueId=${issue.id}`} key={issue.id} style={{ textDecoration: 'none', display: 'block' }}>
                  <div className={styles.issueCard}>
                    <div className={styles.cardTop}>
                      <span className={styles.cardId}>{issue.identifier}</span>
                      <span className={styles.cardStatus}>
                        {getStatusIcon(issue.status)}
                      </span>
                    </div>
                    <div className={styles.cardTitle}>{issue.title}</div>
                    <div className={styles.cardTags}>
                      {issue.product && <span className={`${styles.tag} ${styles.productTag}`}>{issue.product.name}</span>}
                      {issue.project && <span className={`${styles.tag} ${styles.projectTag}`}>{issue.project.name}</span>}
                      {issue.repo && <span className={`${styles.tag} ${styles.repoTag}`}>{issue.repo.name}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* RIGHT COLUMN: CO-PILOT ACTIVITY STREAM */}
          <section className={styles.activityPane}>
            <div className={styles.paneHeader}>
              <GitPullRequest size={14} className={styles.paneIcon} />
              <h2>AI-Human Collaboration</h2>
            </div>
            <div className={styles.activityList}>
              {logs.map(log => (
                <div key={log.id} className={styles.logCard}>
                  <div className={styles.logHeader}>
                    <span className={`${styles.actorBadge} ${log.actorIcon === 'bot' ? styles.botActor : styles.userActor}`}>
                      {log.actor === 'Antigravity' ? '🤖 Antigravity' : '👤 ' + log.actor}
                    </span>
                    <span className={styles.logDate}>
                      {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className={styles.logAction}>{log.action}</p>
                  {log.target && <span className={styles.logTarget}>#{log.target}</span>}
                </div>
              ))}
            </div>
          </section>

        </div>
      </div>

      {isNewIssueOpen && <NewIssueModal />}
      {openIssueId && <IssuePeek issueId={openIssueId} />}
    </>
  );
}

