import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mcpTools } from '@/lib/mcp-tools';

// Unauthenticated self-test for external monitors (DevOpsAssistant L5).
// Response must stay secret-free: pass/fail booleans and generic details only.

interface HealthCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export async function GET() {
  const checks: HealthCheck[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: 'database', passed: true, detail: 'query ok' });
  } catch {
    checks.push({ name: 'database', passed: false, detail: 'query failed' });
  }

  const toolCount = mcpTools.length;
  checks.push({
    name: 'mcp_tool_registry',
    passed: toolCount > 0,
    detail: `${toolCount} tools registered`,
  });

  checks.push({
    name: 'api_key_configured',
    passed: Boolean(process.env.FLUXION_API_KEY),
    detail: process.env.FLUXION_API_KEY
      ? 'auth configured'
      : 'FLUXION_API_KEY unset — MCP auth fails closed',
  });

  const allPassed = checks.every((c) => c.passed);
  return NextResponse.json(
    { status: allPassed ? 'pass' : 'fail', checks },
    { status: allPassed ? 200 : 503 },
  );
}
