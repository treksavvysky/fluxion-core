import styles from './cycles.module.css';
import { getCyclesWithProductMetrics, getProducts } from '@/actions/products';
import { prisma } from '@/lib/prisma';
import { Target, CalendarDays, Plus, Filter, Award } from 'lucide-react';

interface CycleMetric {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  totalIssues: number;
  completedIssues: number;
  completionRate: number;
  velocity: number;
  totalPoints: number;
}

interface ProductInfo {
  id: string;
  name: string;
  slug: string;
}

export default async function CyclesPage({ searchParams }: { searchParams: Promise<{ productId?: string }> }) {
  const params = await searchParams;
  const selectedProductId = params?.productId || 'all';

  const products = await getProducts();
  const cycles = await getCyclesWithProductMetrics(selectedProductId === 'all' ? null : selectedProductId);

  // Fallback seeder if cycles is empty
  if (cycles.length === 0) {
    await prisma.cycle.create({
      data: {
        name: 'Cycle 41',
        startDate: new Date(),
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        isActive: true
      }
    });
    const refreshedCycles = await getCyclesWithProductMetrics(selectedProductId === 'all' ? null : selectedProductId);
    return renderCycles(refreshedCycles, products, selectedProductId);
  }

  return renderCycles(cycles, products, selectedProductId);
}

function renderCycles(cycles: CycleMetric[], products: ProductInfo[], selectedProductId: string) {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>
            <Award size={24} style={{ color: 'var(--accent)', marginRight: '8px' }} />
            Sprint Cycles
          </h1>
          <span className={styles.badge}>
            Align engineering execution loops and monitor cycle velocity metrics by product line.
          </span>
        </div>
        <div className={styles.actions}>
          <button className={styles.newBtn}>
            <Plus size={14} /> New Cycle
          </button>
        </div>
      </header>

      {/* Product Filter Control */}
      <div className={styles.controls}>
        <form method="GET" action="/cycles" className={styles.filterForm}>
          <span className={styles.filterLabel}>
            <Filter size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            Filter by Product Domain:
          </span>
          <select 
            name="productId" 
            className={styles.select}
            defaultValue={selectedProductId}
          >
            <option value="all">All Product Domains</option>
            {products.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.slug})
              </option>
            ))}
          </select>
          {/* Automatic JS hook in case the browser needs it */}
          <script dangerouslySetInnerHTML={{
            __html: `
              document.addEventListener('change', function(e) {
                if (e.target && e.target.name === 'productId') {
                  e.target.form.submit();
                }
              });
            `
          }} />
        </form>
        <span className={styles.badge} style={{ fontSize: '12px', fontWeight: 600 }}>
          {cycles.length} cycles active
        </span>
      </div>
      
      <div>
        <div className={styles.tableHeader}>
          <div>Cycle Name</div>
          <div>Timeline</div>
          <div style={{ textAlign: 'center' }}>Velocity (Done)</div>
          <div style={{ textAlign: 'center' }}>Total Scope</div>
          <div>Cycle Completion Rate</div>
          <div style={{ textAlign: 'right' }}>Issues Status</div>
        </div>
        
        <div className={styles.issueList} style={{ display: 'flex', flexDirection: 'column' }}>
          {cycles.map(cycle => (
            <div key={cycle.id} className={styles.cycleRow}>
              <div className={styles.nameCell}>
                <Target size={14} color="var(--accent)" />
                {cycle.name}
                {cycle.isActive && <span className={styles.activeLabel}>Active</span>}
              </div>
              <div className={styles.timelineCell}>
                <CalendarDays size={14} />
                {new Date(cycle.startDate).toLocaleDateString()} - {new Date(cycle.endDate).toLocaleDateString()}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <span className={styles.velocityPill}>
                  {cycle.velocity} pts completed
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <span className={styles.pointsPill}>
                  {cycle.totalPoints} pts total
                </span>
              </div>
              <div>
                <div className={styles.completionContainer}>
                  <div className={styles.progressLabel}>
                    <span>{cycle.completionRate}%</span>
                    <span style={{ color: 'var(--text-muted)' }}>{cycle.completedIssues}/{cycle.totalIssues} issues</span>
                  </div>
                  <div className={styles.progressBar}>
                    <div className={styles.progressFill} style={{ width: `${cycle.completionRate}%` }}></div>
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: '13px', color: 'var(--text-muted)' }}>
                {cycle.completedIssues} closed • {cycle.totalIssues - cycle.completedIssues} open
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
