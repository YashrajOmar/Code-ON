import { NextResponse } from 'next/server';
import { CodeAnalysisEngine } from '@codeon/code-analysis';
import { generateTrail, type CodePatternSignals } from '@codeon/core/trail-engine';
import { prisma } from '@/lib/prisma';
import { getAuthUser, unauthorized } from '@/lib/auth';

// ── Editorial grounding (same as hint route) ──────────────────────────────────

async function fetchEditorial(problemUrl: string): Promise<{ editorial: string | null; tags: string[] }> {
  try {
    const problem = await prisma.problem.findFirst({
      where: {
        OR: [
          { url: problemUrl },
          { url: { startsWith: problemUrl.replace(/\/$/, '') } },
        ],
      },
    });

    if (!problem) return { editorial: null, tags: [] };

    const parsed = JSON.parse(problem.data);
    const editorial = parsed?.content?.editorialMarkdown || null;
    const tags = parsed?.tags || [];
    return { editorial: editorial && editorial.length > 20 ? editorial : null, tags };
  } catch {
    return { editorial: null, tags: [] };
  }
}

export async function POST(req: Request) {
  try {
    const authUser = await getAuthUser();
    if (!authUser) return unauthorized();

    const { code, problemUrl, problemTags } = await req.json();

    if (!code || !code.trim()) {
      return NextResponse.json({ error: 'No code provided' }, { status: 400 });
    }

    // 1. Analyze the user's code with Tree-sitter AST
    const engine = new CodeAnalysisEngine();
    const report = await engine.analyse({
      code: code.trim(),
      language: 'cpp17',
    });

    // 2. Map OptimizationSignals → CodePatternSignals
    const signals: CodePatternSignals = {
      nestedLoopDepth: report.complexity.nestingDepth,
      hasSortingCall: report.optimization.hasSortingCall,
      hasBinarySearch: report.optimization.hasBinarySearch,
      hasHashMap: report.optimization.hasHashMap,
      hasTwoPointers: report.optimization.hasTwoPointers,
      hasMonotonicStructure: report.optimization.hasMonotonicStructure,
      hasDPTable: report.optimization.hasDPTable,
      hasGraphStructure: report.optimization.hasGraphStructure,
      hasHeap: report.optimization.hasHeap,
      hasAdvancedDS: report.optimization.hasAdvancedDS,
      hasDSU: report.optimization.hasDSU,
      hasPrefixSum: report.optimization.hasPrefixSum,
      hasSlidingWindow: report.optimization.hasSlidingWindow,
    };

    // 3. Fetch editorial from DB
    const { editorial, tags } = await fetchEditorial(problemUrl || '');

    // 4. Generate the trail
    const trail = generateTrail({
      signals,
      timeComplexity: report.complexity.timeComplexity,
      spaceComplexity: report.complexity.spaceComplexity,
      editorialMarkdown: editorial,
      problemTags: problemTags || tags || [],
    });

    return NextResponse.json({
      trail: trail.milestones,
      currentLevel: trail.currentLevel,
      currentIndex: trail.currentIndex,
      detectedTechniques: report.optimization.detectedStructures,
      timeComplexity: report.complexity.timeComplexity,
      spaceComplexity: report.complexity.spaceComplexity,
    });
  } catch (error: unknown) {
    console.error('Trail API error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate trail';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
