import { prisma } from '@/lib/prisma';

// Stage 2 operational rollups for a product. Shared by the products
// dashboard (via actions) and the read_product_metrics MCP tool.
export async function computeProductMetrics(productId: string) {
  const issues = await prisma.issue.findMany({
    where: { productId }
  });

  const openIssues = issues.filter(i => i.status !== 'Done');
  const closedIssues = issues.filter(i => i.status === 'Done');

  // "Defects" are issues mentioning 'bug', 'defect', 'error', or 'fail'
  const defects = issues.filter(i => {
    const text = `${i.title} ${i.description || ''}`.toLowerCase();
    return text.includes('bug') || text.includes('defect') || text.includes('error') || text.includes('fail');
  });
  const openDefects = defects.filter(d => d.status !== 'Done').length;
  const closedDefects = defects.filter(d => d.status === 'Done').length;

  // Technical Debt Score: High = 8 pts, Medium = 4 pts, Low = 2 pts
  const techDebtPoints = openIssues.reduce((sum, i) => {
    if (i.priority === 'High') return sum + 8;
    if (i.priority === 'Medium') return sum + 4;
    return sum + 2; // Low or other
  }, 0);

  const roadmaps = await prisma.roadmap.findMany({
    where: { productId },
    include: {
      issues: { select: { status: true } }
    }
  });

  let totalRoadmapIssues = 0;
  let completedRoadmapIssues = 0;
  roadmaps.forEach(r => {
    totalRoadmapIssues += r.issues.length;
    completedRoadmapIssues += r.issues.filter(i => i.status === 'Done').length;
  });

  const roadmapCompletion = totalRoadmapIssues > 0
    ? Math.round((completedRoadmapIssues / totalRoadmapIssues) * 100)
    : 0;

  return {
    openIssues: openIssues.length,
    closedIssues: closedIssues.length,
    openDefects,
    closedDefects,
    techDebtPoints,
    roadmapCompletion,
    totalRoadmaps: roadmaps.length
  };
}
