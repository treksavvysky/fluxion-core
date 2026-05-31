import styles from './automations.module.css';
import { Cpu, Plus, Play, Zap, Filter, ToggleLeft } from 'lucide-react';
import { getRules, toggleRuleStatus } from '@/actions/automation';
import NewRuleModal from '@/components/NewRuleModal';
import Link from 'next/link';

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const params = await searchParams;
  const isNewOpen = params?.new === 'true';

  const rules = await getRules();

  return (
    <>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>
              <Cpu size={24} style={{ color: 'var(--accent)', marginRight: '8px' }} />
              DevOps Automation Cockpit
            </h1>
            <span className={styles.badge}>
              Ingest system-wide events and define trigger-condition-action logic to coordinate autonomous AI agents and audits.
            </span>
          </div>
          <div>
            <Link href="/automations?new=true">
              <button className={styles.newBtn}>
                <Plus size={14} /> New Rule
              </button>
            </Link>
          </div>
        </header>

        {rules.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '64px 32px' }}>
            <Cpu size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 16px auto' }} />
            <h3 style={{ fontSize: '16px', fontWeight: '600' }}>No Rules Configured</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13.5px', marginTop: '8px' }}>
              Define event listeners to automate build recoveries and deployment audits.
            </p>
          </div>
        ) : (
          <div className={styles.rulesGrid}>
            {rules.map((rule) => (
              <div key={rule.id} className={styles.ruleCard}>
                <div>
                  <div className={styles.cardHeader}>
                    <h3 className={styles.ruleName}>{rule.name}</h3>
                    <form
                      action={async () => {
                        'use server';
                        await toggleRuleStatus(rule.id, !rule.isActive);
                      }}
                    >
                      <button
                        type="submit"
                        className={`${styles.toggleSwitch} ${rule.isActive ? styles.toggleSwitchActive : ''}`}
                        title={rule.isActive ? 'Deactivate Rule' : 'Activate Rule'}
                      >
                        <div className={`${styles.toggleDot} ${rule.isActive ? styles.toggleDotActive : ''}`} />
                      </button>
                    </form>
                  </div>

                  <div className={styles.cardBody} style={{ marginTop: '16px' }}>
                    <div className={styles.flowItem}>
                      <span className={styles.flowLabel}>
                        <Zap size={11} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                        When
                      </span>
                      <span className={styles.flowVal}>{rule.trigger}</span>
                    </div>

                    {rule.condition && (
                      <div className={styles.flowItem}>
                        <span className={styles.flowLabel}>
                          <Filter size={11} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                          If
                        </span>
                        <span className={styles.flowVal}>{rule.condition}</span>
                      </div>
                    )}

                    <div className={styles.flowItem}>
                      <span className={styles.flowLabel}>
                        <Play size={11} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                        Execute
                      </span>
                      <span className={styles.flowValAction}>{rule.action}</span>
                    </div>
                  </div>
                </div>

                <div className={styles.cardFooter}>
                  <span>Status: </span>
                  <strong style={{ color: rule.isActive ? '#10b981' : 'var(--text-muted)' }}>
                    {rule.isActive ? 'Listening' : 'Deactivated'}
                  </strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isNewOpen && <NewRuleModal onCloseUrl="/automations" />}
    </>
  );
}
