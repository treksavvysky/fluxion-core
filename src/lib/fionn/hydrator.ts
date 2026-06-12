import { prisma } from '@/lib/prisma';
import { allowedNextStatuses } from '@/lib/issues';

// Fionn M1 — Context Hydrator (FLX-121).
// Deterministically assembles a single markdown Context Package for an
// issue: product vision -> product boundaries (the scope guard) -> parent
// objective -> the issue contract -> linked repositories -> legal next
// statuses. Same inputs produce a byte-identical package; missing pieces
// degrade to explicit "(not documented)" markers, never errors.

const NOT_DOCUMENTED = '*(not documented)*';

function section(title: string, body: string | null | undefined): string {
  return `## ${title}\n\n${body?.trim() || NOT_DOCUMENTED}\n`;
}

export async function hydrateIssueContext(ref: { issueId?: string; identifier?: string }): Promise<string> {
  const issue = ref.issueId
    ? await prisma.issue.findUnique({ where: { id: ref.issueId } })
    : ref.identifier
      ? await prisma.issue.findUnique({ where: { identifier: ref.identifier.toUpperCase().trim() } })
      : null;
  if (!issue) throw new Error('Issue not found: provide a valid issueId or identifier');

  const [product, parent, project] = await Promise.all([
    issue.productId
      ? prisma.product.findUnique({
          where: { id: issue.productId },
          include: {
            documents: { where: { docType: { in: ['Vision', 'Boundaries'] } }, select: { docType: true, content: true } },
            repositories: { include: { repository: { select: { name: true, url: true } } } },
          },
        })
      : null,
    issue.parentId
      ? prisma.issue.findUnique({
          where: { id: issue.parentId },
          select: { identifier: true, title: true, status: true, description: true, acceptanceCriteria: true },
        })
      : null,
    issue.projectId
      ? prisma.project.findUnique({ where: { id: issue.projectId }, select: { name: true, slug: true, status: true } })
      : null,
  ]);

  const vision = product?.documents.find(d => d.docType === 'Vision')?.content;
  const boundaries = product?.documents.find(d => d.docType === 'Boundaries')?.content;

  const parts: string[] = [];
  parts.push(`# Context Package: ${issue.identifier} — ${issue.title}\n`);
  parts.push(`Assembled deterministically by Fionn (Cognitive Command Layer). Sections are ordered from durable intent to immediate task. The Boundaries section is the scope guard: do not propose or perform work that crosses it.\n`);

  parts.push(section(
    `Product Vision${product ? ` — ${product.name} (${product.slug})` : ''}`,
    product ? vision : '*(no product assigned)*'
  ));
  parts.push(section('Product Boundaries (scope guard)', product ? boundaries : '*(no product assigned)*'));

  parts.push(section(
    'Parent Objective',
    parent
      ? `**${parent.identifier} — ${parent.title}** (${parent.status})\n\n${parent.description?.trim() || NOT_DOCUMENTED}${parent.acceptanceCriteria ? `\n\n**Parent acceptance criteria:**\n${parent.acceptanceCriteria.trim()}` : ''}`
      : '*(root issue — no parent)*'
  ));

  parts.push(section(
    'Project',
    project ? `${project.name} (${project.slug ?? 'no slug'}) — ${project.status}` : '*(not assigned to a project)*'
  ));

  const contract = [
    `**${issue.identifier} — ${issue.title}**`,
    `Status: ${issue.status} · Priority: ${issue.priority}`,
    '',
    `### Description\n\n${issue.description?.trim() || NOT_DOCUMENTED}`,
    `### Context\n\n${issue.context?.trim() || NOT_DOCUMENTED}`,
    `### Acceptance Criteria\n\n${issue.acceptanceCriteria?.trim() || NOT_DOCUMENTED}`,
    `### Technical Intent\n\n${issue.technicalIntent?.trim() || NOT_DOCUMENTED}`,
  ].join('\n');
  parts.push(section('The Issue Contract', contract));

  const repos = product?.repositories ?? [];
  parts.push(section(
    'Linked Repositories',
    repos.length
      ? repos.map(l => `- ${l.repository.name}${l.repository.url ? ` (${l.repository.url})` : ''} — scope: ${l.pathFilter ?? 'whole repo'}`).join('\n')
      : null
  ));

  parts.push(section('Legal Next Statuses', allowedNextStatuses(issue.status).map(s => `- ${s}`).join('\n')));

  return parts.join('\n');
}
