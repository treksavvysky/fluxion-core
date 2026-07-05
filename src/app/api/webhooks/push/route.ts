import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { isAuthorized, resolveIdentity, unauthorizedResponse } from '@/lib/api-auth';
import { ingestPush, type PushPayload } from '@/lib/commits';

// Push-event ingest (FLX-119). Accepts either a native GitHub push webhook
// payload or the synthesized local fallback shape ({repoName, branch,
// commits:[{sha, message, paths}]}) that a post-push hook can build from
// `git log --name-only`. GitHub cannot send custom auth headers, so the
// webhook URL may carry ?token=<key> — validated against the same key
// registry as every other surface (fails closed).

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalize(body: any): PushPayload {
  if (Array.isArray(body?.commits) && body?.repository?.name) {
    // GitHub push event: changed paths arrive split across added/modified/removed.
    return {
      repoName: body.repository.name,
      repoUrl: body.repository.html_url || body.repository.url || undefined,
      branch: typeof body.ref === 'string' ? body.ref.replace('refs/heads/', '') : undefined,
      commits: body.commits.map((c: any) => ({
        sha: c.id || c.sha,
        message: c.message,
        author: c.author?.name || c.author?.username || undefined,
        committedAt: c.timestamp || undefined,
        paths: [...new Set([...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])])] as string[],
      })),
    };
  }
  // Local fallback shape.
  return {
    repoName: body?.repoName,
    repoUrl: body?.repoUrl,
    branch: body?.branch,
    commits: Array.isArray(body?.commits) ? body.commits : [],
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const queryToken = new URL(req.url).searchParams.get('token');
    if (!isAuthorized(req, body?.apiKey) && !resolveIdentity(queryToken).authorized) {
      return unauthorizedResponse();
    }

    const summary = await ingestPush(normalize(body));
    revalidatePath('/');
    return NextResponse.json({ success: true, ...summary }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith('Missing') || message.includes('carries no commits') || message.includes('needs sha') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
