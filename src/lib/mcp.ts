import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { prisma } from './prisma';
import { revalidatePath } from 'next/cache';

export const mcpServer = new Server({
  name: 'fluxion-core-mcp',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {}
  }
});

// Configure tools
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
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
      }
    ]
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'read_issues') {
    const args = request.params.arguments as any;
    const issues = await prisma.issue.findMany({
      where: args?.status ? { status: args.status } : undefined
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(issues, null, 2) }]
    };
  }

  if (request.params.name === 'update_status') {
    const args = request.params.arguments as any;
    if (!args?.issueId || !args?.status) throw new Error('Missing args');
    
    const updated = await prisma.issue.update({
      where: { id: args.issueId },
      data: { status: args.status }
    });
    
    try {
      revalidatePath('/');
    } catch (e) {}

    return {
      content: [{ type: 'text', text: `Successfully updated issue ${updated.identifier} to ${updated.status}` }]
    };
  }

  if (request.params.name === 'create_issue') {
    const args = request.params.arguments as any;
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

    try {
      revalidatePath('/');
      revalidatePath('/cycles');
    } catch (e) {}

    return {
      content: [{ type: 'text', text: `Successfully created issue ${newIssue.identifier}: ${newIssue.title}` }]
    };
  }

  if (request.params.name === 'read_cycles') {
    const cycles = await prisma.cycle.findMany({
      orderBy: { startDate: 'desc' }
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(cycles, null, 2) }]
    };
  }

  if (request.params.name === 'read_roadmaps') {
    const roadmaps = await prisma.roadmap.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(roadmaps, null, 2) }]
    };
  }

  if (request.params.name === 'assign_issue_to_cycle') {
    const args = request.params.arguments as any;
    if (!args?.issueId || args?.cycleId === undefined) throw new Error('Missing issueId or cycleId');
    
    const targetCycleId = args.cycleId === 'none' || args.cycleId === '' ? null : args.cycleId;
    const updated = await prisma.issue.update({
      where: { id: args.issueId },
      data: { cycleId: targetCycleId }
    });

    try {
      revalidatePath('/');
      revalidatePath('/cycles');
    } catch (e) {}

    return {
      content: [{ type: 'text', text: `Successfully updated issue ${updated.identifier} cycle to ${targetCycleId || 'None'}` }]
    };
  }

  throw new Error(`Tool not found: ${request.params.name}`);
});

