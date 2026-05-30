import { mcpState } from '@/lib/mcp-state';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  
  // Validate API Key if configured
  const apiKey = process.env.FLUXION_API_KEY;
  if (apiKey) {
    const providedKey = req.headers['x-api-key'] || req.query.token || req.query['api-key'];
    if (providedKey !== apiKey) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    }
  }

  const transport = mcpState.transport;

  if (!transport) {
    return res.status(400).send('No active SSE connection');
  }

  try {
    // Determine if body is parsed or needs parsing
    const message = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await transport.handleMessage(message);
    res.status(202).send('Accepted');
  } catch (error: any) {
    res.status(400).send(`Invalid message: ${error.message}`);
  }
}

