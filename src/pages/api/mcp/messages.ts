import { getTransport, transportCount } from '@/lib/mcp-state';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  // Validate API key; fail closed when FLUXION_API_KEY is not configured
  const apiKey = process.env.FLUXION_API_KEY;
  const providedKey = req.headers['x-api-key'] || req.query.token || req.query['api-key'];
  if (!apiKey || providedKey !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
  }

  // Route to the per-session transport (FLX-113). The SSE handshake
  // advertises a messages URL carrying sessionId; clients without one fall
  // back to the sole active session when unambiguous.
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
  const transport = getTransport(sessionId);

  if (!transport) {
    const detail = transportCount() === 0
      ? 'No active SSE connection'
      : sessionId
        ? `No active SSE session for sessionId ${sessionId} (and multiple sessions are live, so healing is ambiguous)`
        : 'Multiple active SSE sessions; sessionId query parameter is required';
    return res.status(400).send(detail);
  }

  try {
    // Determine if body is parsed or needs parsing
    const message = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await transport.handleMessage(message);
    res.status(202).send('Accepted');
  } catch (error: unknown) {
    res.status(400).send(`Invalid message: ${error instanceof Error ? error.message : String(error)}`);
  }
}
