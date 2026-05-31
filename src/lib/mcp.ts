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
      },
      {
        name: 'read_document',
        description: 'Read a technical document or architecture wiki article from the Documentation Hub.',
        inputSchema: {
          type: 'object',
          properties: {
            slug: { type: 'string', description: 'The unique URL slug of the document' }
          },
          required: ['slug']
        }
      },
      {
        name: 'write_document',
        description: 'Create or update a technical document or architecture wiki article in the Documentation Hub.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The title of the document' },
            content: { type: 'string', description: 'Markdown formatted content of the document' },
            category: { type: 'string', description: 'Category (Architecture, Schema, API, Guides, General)' },
            productId: { type: 'string', description: 'Optional UUID of the associated Product' },
            repoId: { type: 'string', description: 'Optional UUID of the associated Repository' },
            projectId: { type: 'string', description: 'Optional UUID of the associated Project' }
          },
          required: ['title', 'content']
        }
      },
      {
        name: 'create_change_log',
        description: 'Create a new Change Control audit log (e.g. database migration, release version deploy).',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Deployment, Migration, API Release, Config Change' },
            description: { type: 'string', description: 'Detailed description of the change' },
            reason: { type: 'string', description: 'Why this change was made / rationale' },
            approvedBy: { type: 'string', description: 'Name of the human approver (e.g., George Loudon)' },
            implementedBy: { type: 'string', description: 'Name of the runner (e.g., Antigravity or George Loudon)' },
            productId: { type: 'string', description: 'Optional UUID of the Product scope' },
            repoId: { type: 'string', description: 'Optional UUID of the Repository scope' },
            issueId: { type: 'string', description: 'Optional UUID of the associated Issue' }
          },
          required: ['type', 'description', 'approvedBy', 'implementedBy']
        }
      },
      {
        name: 'query_telemetry',
        description: 'Query live operations telemetry status: environments, active builds, and activities.',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Filter by type: builds, environments, activities' }
          }
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

  if (request.params.name === 'read_products') {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { projects: true, repos: true, issues: true } }
      }
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(products, null, 2) }]
    };
  }

  if (request.params.name === 'create_product') {
    const args = request.params.arguments as any;
    if (!args?.name) throw new Error('Missing name');
    const p = await prisma.product.create({
      data: {
        name: args.name,
        description: args.description || null
      }
    });
    try { revalidatePath('/'); } catch (e) {}
    return {
      content: [{ type: 'text', text: `Successfully created product ${p.name}` }]
    };
  }

  if (request.params.name === 'read_projects') {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { name: true } },
        _count: { select: { issues: true } }
      }
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }]
    };
  }

  if (request.params.name === 'create_project') {
    const args = request.params.arguments as any;
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
    return {
      content: [{ type: 'text', text: `Successfully created project ${proj.name}` }]
    };
  }

  if (request.params.name === 'read_repositories') {
    const repos = await prisma.repository.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { name: true } },
        _count: { select: { issues: true } }
      }
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(repos, null, 2) }]
    };
  }

  if (request.params.name === 'create_repository') {
    const args = request.params.arguments as any;
    if (!args?.name) throw new Error('Missing name');
    const r = await prisma.repository.create({
      data: {
        name: args.name,
        url: args.url || null,
        productId: args.productId || null
      }
    });
    try { revalidatePath('/'); } catch (e) {}
    return {
      content: [{ type: 'text', text: `Successfully created repository ${r.name}` }]
    };
  }

  if (request.params.name === 'assign_issue_details') {
    const args = request.params.arguments as any;
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
    return {
      content: [{ type: 'text', text: `Successfully updated issue ${updated.identifier} mappings.` }]
    };
  }

  if (request.params.name === 'read_document') {
    const args = request.params.arguments as any;
    if (!args?.slug) throw new Error('Missing slug');
    const doc = await prisma.document.findUnique({
      where: { slug: args.slug },
      include: { product: true, repo: true, project: true }
    });
    if (!doc) {
      return { content: [{ type: 'text', text: `Document with slug ${args.slug} not found.` }], isError: true };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }]
    };
  }

  if (request.params.name === 'write_document') {
    const args = request.params.arguments as any;
    if (!args?.title || !args?.content) throw new Error('Missing title or content');
    
    let slug = args.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    const existing = await prisma.document.findUnique({ where: { slug } });
    if (existing) {
      slug = `${slug}-${Math.floor(Math.random() * 1000)}`;
    }

    const doc = await prisma.document.create({
      data: {
        title: args.title,
        slug,
        content: args.content,
        category: args.category || 'General',
        productId: args.productId || null,
        repoId: args.repoId || null,
        projectId: args.projectId || null
      }
    });

    try { revalidatePath('/docs'); } catch (e) {}
    return {
      content: [{ type: 'text', text: `Successfully published document ${doc.title} at slug: ${doc.slug}` }]
    };
  }

  if (request.params.name === 'create_change_log') {
    const args = request.params.arguments as any;
    if (!args?.type || !args?.description || !args?.approvedBy || !args?.implementedBy) {
      throw new Error('Missing required change_log fields');
    }

    const log = await prisma.changeLog.create({
      data: {
        type: args.type,
        description: args.description,
        reason: args.reason || null,
        approvedBy: args.approvedBy,
        implementedBy: args.implementedBy,
        productId: args.productId || null,
        repoId: args.repoId || null,
        issueId: args.issueId || null
      }
    });

    try { revalidatePath('/change-control'); } catch (e) {}
    return {
      content: [{ type: 'text', text: `Successfully registered Change Control audit log ID ${log.id} for type: ${log.type}.` }]
    };
  }

  if (request.params.name === 'query_telemetry') {
    const args = request.params.arguments as any;
    const type = args?.type;
    
    let results: any = {};
    if (!type || type === 'environments') {
      results.environments = await prisma.environment.findMany({ orderBy: { name: 'asc' } });
    }
    if (!type || type === 'builds') {
      results.builds = await prisma.build.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { repo: true } });
    }
    if (!type || type === 'activities') {
      results.activities = await prisma.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
    };
  }

  throw new Error(`Tool not found: ${request.params.name}`);
});



