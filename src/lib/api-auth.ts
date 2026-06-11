// Shared API-key authorization for REST and webhook routes.
// Fails closed: when FLUXION_API_KEY is not configured, every request is
// rejected rather than silently accepting all traffic.

export function isAuthorized(req: Request, bodyApiKey?: unknown): boolean {
  const expected = process.env.FLUXION_API_KEY;
  if (!expected) return false;

  const authHeader = req.headers.get('authorization');
  const provided =
    (typeof bodyApiKey === 'string' ? bodyApiKey : null) ||
    req.headers.get('x-api-key') ||
    (authHeader ? authHeader.replace('Bearer ', '').trim() : null);

  return provided === expected;
}

export function unauthorizedResponse(): Response {
  return Response.json(
    { error: 'Unauthorized: missing or invalid API key' },
    { status: 401 }
  );
}
