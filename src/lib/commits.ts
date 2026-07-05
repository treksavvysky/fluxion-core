import { prisma } from './prisma';

// Commit-diff -> product routing (FLX-119), the Repositories insertion
// point of the execution bridge. Push events carry changed file paths;
// each commit's paths are matched against the repo's ProductRepository
// pathFilter globs, and any leftover paths fall back to the repository's
// directly-linked product. Fluxion records paths and routing only — never
// diffs or code (Boundaries: not a git host).

export interface PushCommit {
  sha: string;
  message: string;
  author?: string;
  committedAt?: string;
  paths: string[];
}

export interface PushPayload {
  repoName: string;
  repoUrl?: string;
  branch?: string;
  commits: PushCommit[];
}

// Dependency-light glob -> RegExp. Segment semantics: `*` and `?` stay
// within one path segment, `**` crosses segments. A trailing `/*` is
// treated as recursive (`/**`): the Stage-2 filter examples (e.g.
// "src/services/auth/*") mean "everything this directory owns", and a
// monorepo mapping that silently ignored nested files would misroute.
// Filters may be comma-separated; a path matches if any alternative does.
export function globToRegExp(glob: string): RegExp {
  const alternatives = glob.split(',').map((g) => g.trim()).filter(Boolean).map((g) => {
    if (g.endsWith('/*')) g = `${g.slice(0, -2)}/**`;
    let re = '';
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === '*') {
        if (g[i + 1] === '*') {
          re += '.*';
          i++;
        } else {
          re += '[^/]*';
        }
      } else if (c === '?') {
        re += '[^/]';
      } else {
        re += /[a-zA-Z0-9_/-]/.test(c) ? c : `\\${c}`;
      }
    }
    return re;
  });
  return new RegExp(`^(?:${alternatives.join('|')})$`);
}

export interface RouteResult {
  productId: string;
  matchedPaths: string[];
  via: 'pathFilter' | 'repoDefault';
}

// Pure routing: match paths against the repo's pathFilter links; paths no
// filter claims fall back to the repository's directly-linked product.
// A commit spanning several products routes to each of them.
export function routeCommitPaths(
  paths: string[],
  links: { productId: string; pathFilter: string | null }[],
  repoDefaultProductId: string | null,
): RouteResult[] {
  const routes = new Map<string, RouteResult>();
  const claimed = new Set<string>();

  for (const link of links) {
    if (!link.pathFilter?.trim()) continue;
    const re = globToRegExp(link.pathFilter.trim());
    const matched = paths.filter((p) => re.test(p));
    if (matched.length === 0) continue;
    matched.forEach((p) => claimed.add(p));
    const existing = routes.get(link.productId);
    if (existing) {
      existing.matchedPaths = [...new Set([...existing.matchedPaths, ...matched])];
    } else {
      routes.set(link.productId, { productId: link.productId, matchedPaths: matched, via: 'pathFilter' });
    }
  }

  const leftovers = paths.filter((p) => !claimed.has(p));
  if (leftovers.length > 0 && repoDefaultProductId) {
    const existing = routes.get(repoDefaultProductId);
    if (existing) {
      existing.matchedPaths = [...new Set([...existing.matchedPaths, ...leftovers])];
    } else {
      routes.set(repoDefaultProductId, { productId: repoDefaultProductId, matchedPaths: leftovers, via: 'repoDefault' });
    }
  }

  return [...routes.values()];
}

export interface IngestSummary {
  repo: string;
  recorded: { sha: string; routes: { product: string; via: string; paths: number }[] }[];
  duplicates: string[];
}

// Idempotent push ingest: the repo is resolved (or registered) by name,
// each commit is recorded once per (repo, sha) — webhook re-deliveries
// land in `duplicates` — and routing rows are computed at ingest.
export async function ingestPush(payload: PushPayload): Promise<IngestSummary> {
  if (!payload.repoName?.trim()) throw new Error('Missing repoName (or repository.name for GitHub payloads)');
  if (!Array.isArray(payload.commits) || payload.commits.length === 0) {
    throw new Error('Push payload carries no commits');
  }

  // Matches archived records too (FLX-137): a push naming an archived repo
  // must not create a duplicate active record, and must not silently
  // unarchive it — commits still land against the archived record.
  let repo = await prisma.repository.findFirst({
    where: { name: { equals: payload.repoName.trim(), mode: 'insensitive' } },
  });
  if (!repo) {
    repo = await prisma.repository.create({
      data: { name: payload.repoName.trim(), url: payload.repoUrl || null },
    });
  }

  const links = await prisma.productRepository.findMany({
    where: { repositoryId: repo.id },
    select: { productId: true, pathFilter: true, product: { select: { slug: true } } },
  });
  const slugByProduct = new Map(links.map((l) => [l.productId, l.product.slug]));
  if (repo.productId && !slugByProduct.has(repo.productId)) {
    const p = await prisma.product.findUnique({ where: { id: repo.productId }, select: { slug: true } });
    if (p) slugByProduct.set(repo.productId, p.slug);
  }

  const summary: IngestSummary = { repo: repo.name, recorded: [], duplicates: [] };

  for (const c of payload.commits) {
    if (!c.sha || !Array.isArray(c.paths)) throw new Error(`Commit entry needs sha and paths[] (got sha "${c.sha ?? ''}")`);
    const existing = await prisma.commit.findUnique({ where: { repoId_sha: { repoId: repo.id, sha: c.sha } } });
    if (existing) {
      summary.duplicates.push(c.sha);
      continue;
    }

    const routes = routeCommitPaths(c.paths, links, repo.productId);
    await prisma.commit.create({
      data: {
        sha: c.sha,
        message: c.message || '(no message)',
        author: c.author || null,
        branch: payload.branch || null,
        committedAt: c.committedAt ? new Date(c.committedAt) : null,
        paths: c.paths,
        repoId: repo.id,
        routes: { create: routes.map((r) => ({ productId: r.productId, matchedPaths: r.matchedPaths, via: r.via })) },
      },
    });
    summary.recorded.push({
      sha: c.sha,
      routes: routes.map((r) => ({ product: slugByProduct.get(r.productId) ?? r.productId, via: r.via, paths: r.matchedPaths.length })),
    });
  }

  return summary;
}
