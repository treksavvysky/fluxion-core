import { mcpServer } from '@/lib/mcp';
import { mcpState } from '@/lib/mcp-state';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const providedKey = req.headers['x-api-key'] || req.query.token || req.query['api-key'];
  const apiKey = process.env.FLUXION_API_KEY;
  if (apiKey && providedKey !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
  }

  // Support stateless HTTP JSON-RPC directly on the handshake URL /api/mcp
  if (req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');
    const request = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Stateless HTTP JSON-RPC handler (used by HTTP-only MCP clients)
    try {
      const method = request?.method;
      const id = request?.id;

      if (method === 'initialize') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'fluxion-core-mcp',
              version: '1.0.0'
            }
          }
        });
      }

      if (method === 'notifications/initialized') {
        return res.status(200).json({ jsonrpc: '2.0', result: null });
      }

      if (method === 'tools/list') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'read_issues',
                description: 'Read the backlog of open issues and tickets inside the Fluxion Core database.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', description: 'Filter by status (e.g., Todo, In Progress)' }
                  }
                }
              },
              {
                name: 'update_status',
                description: 'Update the status of a specific issue.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    issueId: { type: 'string', description: 'The UUID of the issue' },
                    status: { type: 'string', description: 'The new status (Todo, In Progress, Done)' }
                  },
                  required: ['issueId', 'status']
                }
              },
              {
                name: 'create_issue',
                description: 'Create a new issue inside the Fluxion Core database.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string', description: 'The title of the issue' },
                    description: { type: 'string', description: 'Detailed description of the issue' },
                    priority: { type: 'string', description: 'Priority level (Low, Medium, High)' },
                    status: { type: 'string', description: 'Initial status (Todo, In Progress, Done, Backlog)' },
                    cycleId: { type: 'string', description: 'Optional UUID of the cycle to associate the issue with' },
                    roadmapId: { type: 'string', description: 'Optional UUID of the roadmap to associate the issue with' }
                  },
                  required: ['title']
                }
              },
              {
                name: 'read_cycles',
                description: 'Read the list of active or upcoming development cycles/sprints.',
                inputSchema: {
                  type: 'object',
                  properties: {}
                }
              },
              {
                name: 'read_roadmaps',
                description: 'Read the strategic roadmaps and epics.',
                inputSchema: {
                  type: 'object',
                  properties: {}
                }
              },
              {
                name: 'assign_issue_to_cycle',
                description: 'Assign a specific issue to a development cycle/sprint.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    issueId: { type: 'string', description: 'The UUID of the issue' },
                    cycleId: { type: 'string', description: 'The UUID of the cycle, or "none" / null to unassign' }
                  },
                  required: ['issueId', 'cycleId']
                }
              },
              {
                name: 'read_products',
                description: 'Read the list of products from the Fluxion Core database.',
                inputSchema: {
                  type: 'object',
                  properties: {}
                }
              },
              {
                name: 'create_product',
                description: 'Create a new product inside the Fluxion Core database.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'The name of the product' },
                    description: { type: 'string', description: 'Detailed description of the product' }
                  },
                  required: ['name']
                }
              },
              {
                name: 'read_projects',
                description: 'Read the list of active or upcoming projects (temporal milestones).',
                inputSchema: {
                  type: 'object',
                  properties: {}
                }
              },
              {
                name: 'create_project',
                description: 'Create a new project (temporal milestone) inside the Fluxion Core database.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'The name of the project' },
                    description: { type: 'string', description: 'Detailed description of the project' },
                    productId: { type: 'string', description: 'Optional UUID of the product this project belongs to' },
                    status: { type: 'string', description: 'Initial status (Planned, Active, Completed, Cancelled)' }
                  },
                  required: ['name']
                }
              },
              {
                name: 'read_repositories',
                description: 'Read the list of codebase repositories.',
                inputSchema: {
                  type: 'object',
                  properties: {}
                }
              },
              {
                name: 'create_repository',
                description: 'Create a new repository record inside the Fluxion Core database.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'The name of the repository' },
                    url: { type: 'string', description: 'The URL of the repository (e.g. GitHub URL)' },
                    productId: { type: 'string', description: 'Optional UUID of the product this repository belongs to' }
                  },
                  required: ['name']
                }
              },
              {
                name: 'assign_issue_details',
                description: 'Assign an issue to a product, project, and/or repository.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    issueId: { type: 'string', description: 'The UUID of the issue' },
                    productId: { type: 'string', description: 'The UUID of the product, or "none" / null to unassign' },
                    projectId: { type: 'string', description: 'The UUID of the project, or "none" / null to unassign' },
                    repoId: { type: 'string', description: 'The UUID of the repository, or "none" / null to unassign' }
                  },
                  required: ['issueId']
                }
              }
            ]
          }
        });
      }

      if (method === 'tools/call') {
        const toolName = request.params?.name;
        const args = request.params?.arguments || {};

        if (toolName === 'read_issues') {
          const issues = await prisma.issue.findMany({
            where: args?.status ? { status: args.status } : undefined
          });
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(issues, null, 2) }]
            }
          });
        }

        if (toolName === 'update_status') {
          if (!args?.issueId || !args?.status) throw new Error('Missing args');
          const updated = await prisma.issue.update({
            where: { id: args.issueId },
            data: { status: args.status }
          });
          try { revalidatePath('/'); } catch (e) {}
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Successfully updated issue ${updated.identifier} to ${updated.status}` }]
            }
          });
        }

        if (toolName === 'create_issue') {
          if (!args?.title) throw new Error('Missing title');
          const count = await prisma.issue.count();
          const identifier = `FLX-${101 + count}`;
          const newIssue = await prisma.issue.create({
            data: {
              identifier,
              title: args.title,
              description: args.description || null,
              priority: args.priority || 'Medium',
              status: args.status || 'Todo',
              cycleId: args.cycleId || null,
              roadmapId: args.roadmapId || null
            }
          });
          try { revalidatePath('/'); revalidatePath('/cycles'); } catch (e) {}
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Successfully created issue ${newIssue.identifier}: ${newIssue.title}` }]
            }
          });
        }

        if (toolName === 'read_cycles') {
          const cycles = await prisma.cycle.findMany({ orderBy: { startDate: 'desc' } });
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(cycles, null, 2) }]
            }
          });
        }

        if (toolName === 'read_roadmaps') {
          const roadmaps = await prisma.roadmap.findMany({ orderBy: { createdAt: 'desc' } });
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(roadmaps, null, 2) }]
            }
          });
        }

        if (toolName === 'assign_issue_to_cycle') {
          if (!args?.issueId || args?.cycleId === undefined) throw new Error('Missing issueId or cycleId');
          const targetCycleId = args.cycleId === 'none' || args.cycleId === '' ? null : args.cycleId;
          const updated = await prisma.issue.update({
            where: { id: args.issueId },
            data: { cycleId: targetCycleId }
          });
          try { revalidatePath('/'); revalidatePath('/cycles'); } catch (e) {}
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Successfully updated issue ${updated.identifier} cycle to ${targetCycleId || 'None'}` }]
            }
          });
        }

        if (toolName === 'read_products') {
          const products = await prisma.product.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
              _count: { select: { projects: true, repos: true, issues: true } }
            }
          });
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(products, null, 2) }]
            }
          });
        }

        if (toolName === 'create_product') {
          if (!args?.name) throw new Error('Missing name');

          let slugBase = args.name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
          if (slugBase.length > 10) slugBase = slugBase.substring(0, 10);
          if (slugBase.length < 2) slugBase = 'PROD';

          let slug = slugBase;
          const existing = await prisma.product.findUnique({ where: { slug } });
          if (existing) {
            slug = `${slugBase.substring(0, 6)}-${Math.floor(Math.random() * 1000)}`;
          }

          const p = await prisma.product.create({
            data: {
              name: args.name,
              slug,
              description: args.description || null,
              status: 'Active'
            }
          });
          try { revalidatePath('/'); } catch (e) {}
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Successfully created product ${p.name} with slug ${p.slug}` }]
            }
          });
        }

        if (toolName === 'read_projects') {
          const projects = await prisma.project.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
              product: { select: { name: true } },
              _count: { select: { issues: true } }
            }
          });
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }]
            }
          });
        }

        if (toolName === 'create_project') {
          if (!args?.name) throw new Error('Missing name');
          const proj = await prisma.project.create({
            data: {
              name: args.name,
              description: args.description || null,
              status: args.status || 'Planned',
              productId: args.productId || null
            }
          });
          try { revalidatePath('/'); } catch (e) {}
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Successfully created project ${proj.name}` }]
            }
          });
        }

        if (toolName === 'read_repositories') {
          const repos = await prisma.repository.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
              product: { select: { name: true } },
              _count: { select: { issues: true } }
            }
          });
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(repos, null, 2) }]
            }
          });
        }

        if (toolName === 'create_repository') {
          if (!args?.name) throw new Error('Missing name');
          const r = await prisma.repository.create({
            data: {
              name: args.name,
              url: args.url || null,
              productId: args.productId || null
            }
          });
          try { revalidatePath('/'); } catch (e) {}
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Successfully created repository ${r.name}` }]
            }
          });
        }

        if (toolName === 'assign_issue_details') {
          if (!args?.issueId) throw new Error('Missing issueId');
          const updateData: any = {};
          if (args.productId !== undefined) {
            updateData.productId = args.productId === 'none' || args.productId === '' ? null : args.productId;
          }
          if (args.projectId !== undefined) {
            updateData.projectId = args.projectId === 'none' || args.projectId === '' ? null : args.projectId;
          }
          if (args.repoId !== undefined) {
            updateData.repoId = args.repoId === 'none' || args.repoId === '' ? null : args.repoId;
          }
          const updated = await prisma.issue.update({
            where: { id: args.issueId },
            data: updateData
          });
          try { revalidatePath('/'); } catch (e) {}
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Successfully updated issue ${updated.identifier} mappings.` }]
            }
          });
        }

        throw new Error(`Tool not found: ${toolName}`);
      }

      return res.status(404).json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      });

    } catch (err: any) {
      return res.status(500).json({
        jsonrpc: '2.0',
        id: request?.id,
        error: { code: -32603, message: err.message }
      });
    }
  }

  if (req.method !== 'GET') return res.status(405).end();

  // Prevent response buffering and stream dropping (Nginx, Next.js dev server, CDNs)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (mcpState.transport) {
    try {
      await mcpServer.close();
    } catch (e) {}
  }

  const transport = new SSEServerTransport(`/api/mcp/messages?token=${providedKey || ''}`, res as any);
  mcpState.transport = transport;

  await mcpServer.connect(transport);
  
  if (res.flushHeaders) {
    res.flushHeaders();
  }

  // Periodic keep-alive heartbeat ping every 15 seconds to prevent idle socket drop
  const heartbeatInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(':\n\n'); // SSE comment line
      if ((res as any).flush) {
        (res as any).flush();
      }
    }
  }, 15000);
  
  res.socket?.on('close', () => {
    clearInterval(heartbeatInterval);
    mcpState.transport = null;
  });
}

// Next.js API config to allow long-running asynchronous execution streams
export const config = {
  api: {
    externalResolver: true,
  },
};



