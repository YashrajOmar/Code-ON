import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptKey, decryptKey } from '@/lib/crypto';
import { embedText, toVectorLiteral } from '@/lib/embeddings';
import { getAuthUser, unauthorized } from '@/lib/auth';
import { rateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit';

/**
 * GET /api/settings/seed-code
 * Returns the list of trained solutions (titles + topics, no code for security).
 */
export async function GET() {
  try {
    const authUser = await getAuthUser();
    if (!authUser) return NextResponse.json({ solutions: [] });

    const userId = authUser.userId;

    const rows = await prisma.$queryRaw<Array<{ topic: string; performanceSummary: string | null; language: string | null; updatedAt: Date }>>`
      SELECT topic, "performanceSummary", "language", "updatedAt"
      FROM "UserTopicProfile"
      WHERE "userId" = ${userId} AND "codeSnippet" IS NOT NULL
      ORDER BY "updatedAt" DESC
    `;

    const solutions = rows.map((r) => {
      const titleMatch = r.performanceSummary?.match(/solution "([^"]+)"/);
      const platformMatch = r.performanceSummary?.match(/Platform:\s*(\w+)/);
      const tagsMatch = r.performanceSummary?.match(/Tags:\s*(.+)/);
      const patternsMatch = r.performanceSummary?.match(/Patterns used:\s*(.+)/);

      const title = titleMatch?.[1] || r.topic;
      const platform = platformMatch?.[1] || 'manual';
      const tags = tagsMatch?.[1]?.split(',').map((t) => t.trim()).filter(Boolean) || [];
      const patterns = patternsMatch?.[1]?.split(',').map((p) => p.trim()).filter(Boolean) || [];

      let url: string | null = null;
      if (platform === 'codeforces') {
        url = `https://codeforces.com/problemset`;
      } else if (platform === 'leetcode') {
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        url = `https://leetcode.com/problems/${slug}/`;
      }

      return {
        topic: r.topic,
        title,
        platform,
        tags,
        patterns,
        language: r.language || 'cpp',
        url,
        updatedAt: r.updatedAt?.toISOString?.() || null,
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
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : '';
    let userId: string;

    // Check for companion app token (cot_xxx format)
    if (token.startsWith('cot_')) {
      // Look up the token in ApiKey table
      const allTokens = await prisma.apiKey.findMany({
        where: { provider: 'companion_token' },
      });

      let foundUserId: string | null = null;
      for (const t of allTokens) {
        const decrypted = decryptKey(t.encryptedKey);
        if (decrypted === token) {
          foundUserId = t.userId;
          break;
        }
      }

      if (!foundUserId) {
        return NextResponse.json({ error: 'Invalid companion token' }, { status: 401 });
      }
      userId = foundUserId;
    } else {
      // Regular auth via Clerk (used by the web app's manual paste form)
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

    for (const sol of solutions) {
      if (!sol.code || sol.code.trim().length < 20) continue;

      const code = sol.code.trim();
      const problemTitle = sol.problemTitle || 'Unknown Problem';
      const platform = sol.platform || 'manual';
      const tags = sol.tags || [];

      const topic = tags[0] || 'general';
      const ragKey = `${topic}_${problemTitle.substring(0, 30).replace(/[^a-z0-9]/gi, '_')}`;

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
- Platform: ${platform}
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
