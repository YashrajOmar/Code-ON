import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { embedText, toVectorLiteral } from '@/lib/embeddings';
import { getAuthUser, unauthorized } from '@/lib/auth';
import { rateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit';

/**
 * GET /api/settings/seed-code
 * Returns the list of trained solutions (titles + topics, no code for security).
 */
export async function GET() {
  try {
    const authHeader = undefined;
    const webhookSecret = process.env.INGEST_WEBHOOK_SECRET || 'codeon-companion-secret';

    // Allow companion app to fetch count via webhook secret
    const authUser = await getAuthUser();
    let userId: string;

    if (authUser) {
      userId = authUser.userId;
    } else {
      // Fallback to demo user for companion app
      let user = await prisma.user.findUnique({ where: { email: 'demo@codeon.dev' } });
      if (!user) {
        return NextResponse.json({ solutions: [], total: 0 });
      }
      userId = user.id;
    }

    const rows = await prisma.$queryRaw<Array<{ topic: string; performanceSummary: string | null }>>`
      SELECT topic, "performanceSummary"
      FROM "UserTopicProfile"
      WHERE "userId" = ${userId} AND "codeSnippet" IS NOT NULL
      ORDER BY "updatedAt" DESC
    `;

    const solutions = rows.map((r: { topic: string; performanceSummary: string | null }) => {
      // Extract problem title from the performance summary
      const titleMatch = r.performanceSummary?.match(/solution "([^"]+)"/);
      return {
        topic: r.topic,
        title: titleMatch?.[1] || r.topic,
      };
    });

    return NextResponse.json({ solutions });
  } catch {
    return NextResponse.json({ solutions: [] });
  }
}

/**
 * POST /api/settings/seed-code
 *
 * Accepts pasted AC solutions, deduplicates by code hash, stores in RAG.
 */
export async function POST(req: Request) {
  try {
    // Check for companion app webhook secret first (no Clerk auth needed)
    const authHeader = req.headers.get('authorization');
    const webhookSecret = process.env.INGEST_WEBHOOK_SECRET || 'codeon-companion-secret';
    let userId: string;

    if (authHeader === `Bearer ${webhookSecret}`) {
      // Companion app — find or create demo user
      let user = await prisma.user.findUnique({ where: { email: 'demo@codeon.dev' } });
      if (!user) {
        user = await prisma.user.create({
          data: { email: 'demo@codeon.dev', displayName: 'Developer' },
        });
      }
      userId = user.id;
    } else {
      // Regular auth via Clerk
      const authUser = await getAuthUser();
      if (!authUser) return unauthorized();
      userId = authUser.userId;
    }

    const rl = rateLimit(`seed:${userId}`, RATE_LIMITS.seed);
    if (!rl.allowed) return tooManyRequests(rl.resetAt);

    const body = await req.json();
    const { solutions } = body;

    if (!Array.isArray(solutions) || solutions.length === 0) {
      return NextResponse.json({ error: 'No solutions provided' }, { status: 400 });
    }

    // userId already set above from auth or webhook

    // Get existing trained solutions to check for duplicates
    const existing = await prisma.$queryRaw<Array<{ topic: string }>>`
      SELECT topic FROM "UserTopicProfile"
      WHERE "userId" = ${userId} AND "codeSnippet" IS NOT NULL
    `;
    const existingTopics = new Set(existing.map((r: { topic: string }) => r.topic));

    let ingested = 0;
    let skipped = 0;

    for (const sol of solutions) {
      if (!sol.code || sol.code.trim().length < 20) continue;

      const code = sol.code.trim();
      const problemTitle = sol.problemTitle || 'Unknown Problem';
      const platform = sol.platform || 'manual';
      const tags = sol.tags || [];

      const topic = tags[0] || 'general';
      const ragKey = `${topic}_${problemTitle.substring(0, 30).replace(/[^a-z0-9]/gi, '_')}`;

      // Skip if this exact problem+topic was already trained
      if (existingTopics.has(ragKey)) {
        // Update it instead of skipping — user may have pasted better code
      }

      // Analyze the code for style signals
      const styleSignals: string[] = [];
      const lowerCode = code.toLowerCase();

      if (/ios::sync_with_stdio|scanf|printf|cin\.tie/.test(code)) styleSignals.push('fast I/O');
      if (/unordered_map|map|set/.test(lowerCode)) styleSignals.push('STL containers');
      if (/sort\(|lower_bound|upper_bound|binary_search/.test(lowerCode)) styleSignals.push('STL algorithms');
      if (/long\s+long|ll\s|int64/.test(lowerCode)) styleSignals.push('long long');
      if (/#define\s+\w/.test(code)) styleSignals.push('macros');
      if (/for\s*\(\s*(?:auto|int)\s+\w+\s*:\s/.test(code)) styleSignals.push('range-based loops');
      if (/priority_queue|make_heap/.test(lowerCode)) styleSignals.push('heaps');
      if (/vector<vector|dp\[|memo\[/.test(lowerCode)) styleSignals.push('2D arrays/DP');

      const styleSummary = `Coding style from pasted solution "${problemTitle}":
- Language: C++
- Patterns used: ${styleSignals.join(', ') || 'basic'}
- Code length: ${code.length} chars
- ${tags.length > 0 ? `Tags: ${tags.join(', ')}` : 'No tags provided'}`;

      const embedInput = `Topic: ${topic}. ${styleSummary}\nCode sample:\n${code.substring(0, 300)}`;
      const embedding = await embedText(embedInput);
      const literal = toVectorLiteral(embedding);

      await prisma.$executeRaw`
        INSERT INTO "UserTopicProfile" (id, "userId", topic, "skillTier", "performanceSummary", "codeSnippet", "language", embedding, "updatedAt")
        VALUES (
          gen_random_uuid()::text,
          ${userId},
          ${ragKey},
          'Medium',
          ${styleSummary},
          ${code.substring(0, 2000)},
          'cpp',
          ${literal}::vector,
          NOW()
        )
        ON CONFLICT ("userId", topic)
        DO UPDATE SET
          "performanceSummary" = EXCLUDED."performanceSummary",
          "codeSnippet" = EXCLUDED."codeSnippet",
          embedding = EXCLUDED.embedding,
          "updatedAt" = NOW()
      `;

      existingTopics.add(ragKey);
      ingested++;
    }

    return NextResponse.json({
      success: true,
      ingested,
      total: existingTopics.size,
      message: `${ingested} solution(s) stored. You now have ${existingTopics.size} trained solutions.`,
    });
  } catch (error: any) {
    console.error('Seed code error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to store solutions' },
      { status: 500 }
    );
  }
}
