import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { embedText, toVectorLiteral } from '@/lib/embeddings';
import { renderPage } from '@codeon/scrapers';
import { getAuthUser, unauthorized } from '@/lib/auth';
import { rateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit';

// ── Extract username from URL or handle ─────────────────────────────────────

function extractHandle(input: string, platform: string): string {
  let handle = input.trim();
  if (handle.startsWith('http://') || handle.startsWith('https://')) {
    try {
      const url = new URL(handle);
      const path = url.pathname.replace(/\/$/, '');
      if (platform === 'codeforces') {
        const match = path.match(/\/profile\/(.+)/);
        handle = match ? match[1] : path.split('/').pop() || handle;
      } else if (platform === 'leetcode') {
        const match = path.match(/\/(?:u\/|users\/)?(.+)/);
        handle = match ? match[1] : path.split('/').pop() || handle;
      } else {
        handle = path.split('/').pop() || handle;
      }
    } catch { /* use as-is */ }
  }
  return handle.replace(/^@/, '');
}

// ── Skill tier inference ─────────────────────────────────────────────────────

function inferSkillTier(count: number, rating?: number | null): string {
  if (rating) {
    if (rating < 1200) return 'Beginner';
    if (rating < 1400) return 'Easy';
    if (rating < 1800) return 'Medium';
    if (rating < 2200) return 'Hard';
    if (rating < 2600) return 'Advanced';
    return 'Expert';
  }
  if (count < 5) return 'Beginner';
  if (count < 15) return 'Easy';
  if (count < 30) return 'Medium';
  if (count < 60) return 'Hard';
  return 'Advanced';
}

// ── Fetch actual submission source code from CF ──────────────────────────────

async function fetchCFSubmissionCode(contestId: number, submissionId: number): Promise<string | null> {
  try {
    const url = `https://codeforces.com/contest/${contestId}/submission/${submissionId}`;
    // CF has JS bot protection on submission pages.
    // Try direct fetch first (sometimes works), then Playwright as fallback.
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (res.ok) {
      const html = await res.text();
      const match = html.match(/id="program-source-text"[^>]*>([\s\S]*?)<\/pre>/);
      if (match) {
        return match[1]
          .replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&')
          .replace(/"/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
          .trim();
      }
      // If we got the "browser is being checked" page, try Playwright
      if (html.includes('browser is being checked') || html.includes('Please wait')) {
        try {
          const renderedHtml = await renderPage(url);
          const match2 = renderedHtml.match(/id="program-source-text"[^>]*>([\s\S]*?)<\/pre>/);
          if (match2) {
            return match2[1]
              .replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&')
              .replace(/"/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
              .trim();
          }
        } catch { /* Playwright failed — no code */ }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Analyze coding style from source code ─────────────────────────────────────

interface CodeStyleSignals {
  language: string;
  usesFastIO: boolean;
  usesSTL: string[];
  usesLongLong: boolean;
  usesMacros: boolean;
  loopStyle: string;
  variableStyle: string;
  averageFunctionLength: number;
  codeSnippets: string[];
}

function analyzeCodeStyle(code: string): CodeStyleSignals {
  const lines = code.split('\n');
  const lowerCode = code.toLowerCase();

  return {
    language: 'cpp',
    usesFastIO: /ios::sync_with_stdio|scanf|printf|cin\.tie/.test(code),
    usesSTL: [
      ...new Set(
        ['sort', 'unordered_map', 'map', 'set', 'vector', 'priority_queue', 'stack', 'queue',
         'lower_bound', 'upper_bound', 'binary_search', 'min', 'max', 'accumulate', 'unique']
          .filter((s) => lowerCode.includes(s))
      ),
    ],
    usesLongLong: /long\s+long|ll\s|int64/.test(lowerCode),
    usesMacros: /#define\s+\w/.test(code),
    loopStyle: /for\s*\(\s*(?:auto|int)\s+\w+\s*:\s/.test(code) ? 'range-based' : 'index-based',
    variableStyle: /\bint\s+[a-z]\b/.test(code) ? 'short-names' : 'descriptive',
    averageFunctionLength: Math.round(lines.length / Math.max(1, (code.match(/int\s+\w+\s*\(/g) || []).length)),
    codeSnippets: [],
  };
}

// ── RAG Ingestion with actual code ───────────────────────────────────────────

async function ingestTopicProfiles(
  userId: string,
  tags: Array<{ tag: string; count: number }>,
  platform: string,
  handle: string,
  rating?: number | null,
  codeSamples?: Array<{ code: string; tags: string[]; problemName: string }>
): Promise<void> {
  // userId is already the DB user ID — no need to look up by email
  if (!userId) return;

  // Aggregate coding style from all code samples
  let combinedStyle = '';
  let bestCodeSnippet = '';

  if (codeSamples && codeSamples.length > 0) {
    const styles = codeSamples.map((s) => analyzeCodeStyle(s.code));
    const allSTL = [...new Set(styles.flatMap((s) => s.usesSTL))];
    combinedStyle = `Coding style analysis from ${codeSamples.length} accepted submissions:
- Language: C++
- Uses fast I/O: ${styles.some((s) => s.usesFastIO) ? 'yes' : 'no'}
- STL containers used: ${allSTL.join(', ') || 'none'}
- Uses long long: ${styles.some((s) => s.usesLongLong) ? 'yes' : 'no'}
- Uses macros (#define): ${styles.some((s) => s.usesMacros) ? 'yes' : 'no'}
- Loop style: ${styles[0]?.loopStyle || 'index-based'}
- Variable naming: ${styles[0]?.variableStyle || 'short-names'}`;

    // Pick the shortest clean code snippet as the representative example
    const cleanSnippets = codeSamples
      .map((s) => s.code)
      .filter((c) => c.length > 20 && c.length < 3000)
      .sort((a, b) => a.length - b.length);
    if (cleanSnippets.length > 0) {
      bestCodeSnippet = cleanSnippets[0];
    }
  }

  for (const { tag, count } of tags) {
    const skillTier = inferSkillTier(count, rating);

    // Rich summary that connects to the user's actual submissions
    let performanceSummary = `From user's actual Codeforces submissions (handle: ${handle}):
- Topic: ${tag}
- Problems solved in this topic: ${count}
- User's CF rating: ${rating || 'unrated'}
- User's rank: ${rating ? (rating < 1200 ? 'Newbie' : rating < 1400 ? 'Pupil' : rating < 1600 ? 'Specialist' : rating < 1900 ? 'Expert' : 'Candidate Master') : 'unrated'}
- Preferred language: C++ (GCC)
- Skill level on this topic: ${skillTier}

This means the user ${count > 10 ? 'is comfortable with' : 'is still learning'} ${tag}. ${count > 10 ? 'You can use advanced hints and assume they know the basics.' : 'Use simple language and explain concepts from scratch.'}`;

    try {
      const embedding = await embedText(performanceSummary);
      const literal = toVectorLiteral(embedding);

      await prisma.$executeRaw`
        INSERT INTO "UserTopicProfile" (id, "userId", topic, "skillTier", "performanceSummary", "language", embedding, "updatedAt")
        VALUES (
          gen_random_uuid()::text,
          ${userId},
          ${tag},
          ${skillTier},
          ${performanceSummary},
          'cpp',
          ${literal}::vector,
          NOW()
        )
        ON CONFLICT ("userId", topic)
        DO UPDATE SET
          "skillTier" = EXCLUDED."skillTier",
          "performanceSummary" = EXCLUDED."performanceSummary",
          "language" = EXCLUDED."language",
          embedding = EXCLUDED.embedding,
          "updatedAt" = NOW()
      `;
    } catch (e) {
      console.warn(`[RAG Ingest] Failed to embed topic "${tag}":`, e instanceof Error ? e.message : e);
    }
  }
}

// ── Codeforces scrape (with actual code fetching) ────────────────────────────

async function scrapeCodeforces(handle: string) {
  try {
    const [statusRes, infoRes] = await Promise.all([
      fetch(`https://codeforces.com/api/user.status?handle=${handle}&from=1&count=100`),
      fetch(`https://codeforces.com/api/user.info?handles=${handle}`),
    ]);

    if (!statusRes.ok || !infoRes.ok) return { error: `Codeforces API error. Check handle: ${handle}` };

    const statusData = await statusRes.json();
    const infoData = await infoRes.json();

    if (statusData.status !== 'OK' || infoData.status !== 'OK') return { error: `Invalid Codeforces handle: ${handle}` };

    const user = infoData.result[0];
    const submissions: any[] = statusData.result;
    const accepted = submissions.filter((s: any) => s.verdict === 'OK');

    // Build tag frequency map + track which problems use which tags
    const tagCounts: Record<string, number> = {};
    const solvedIds = new Set<string>();

    for (const sub of accepted) {
      const key = `${sub.problem.contestId}${sub.problem.index}`;
      if (solvedIds.has(key)) continue;
      solvedIds.add(key);
      for (const tag of (sub.problem.tags || [])) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    // Fetch actual source code from 2 most recent AC C++ submissions
    // (Playwright is slow — 5-10s per page — so we limit to 2)
    const cppSubs = accepted
      .filter((s: any) => s.programmingLanguage?.includes('C++'))
      .slice(0, 2);

    const codeSamples: Array<{ code: string; tags: string[]; problemName: string }> = [];

    for (const sub of cppSubs) {
      // Rate limit: wait 500ms between requests
      await new Promise((r) => setTimeout(r, 500));
      const code = await fetchCFSubmissionCode(sub.problem.contestId, sub.id);
      if (code && code.length > 20) {
        codeSamples.push({
          code,
          tags: sub.problem.tags || [],
          problemName: sub.problem.name,
        });
      }
    }

    return {
      handle,
      platform: 'codeforces',
      rating: user.rating ?? null,
      maxRating: user.maxRating ?? null,
      rank: user.rank ?? null,
      totalSolved: solvedIds.size,
      topTags,
      codeSamplesFetched: codeSamples.length,
      recentProblems: accepted.slice(0, 20).map((s: any) => ({
        id: `${s.problem.contestId}${s.problem.index}`,
        name: s.problem.name,
        rating: s.problem.rating,
        tags: s.problem.tags,
        solvedAt: new Date(s.creationTimeSeconds * 1000).toISOString(),
      })),
      _codeSamples: codeSamples, // Internal — used for RAG ingestion, stripped from response
    };
  } catch (err: any) {
    return { error: err.message };
  }
}

// ── LeetCode ──────────────────────────────────────────────────────────────────

async function scrapeLeetCode(handle: string) {
  const query = `
    query getUserProfile($username: String!) {
      matchedUser(username: $username) {
        username
        profile { realName userAvatar ranking }
        submitStatsGlobal { acSubmissionNum { difficulty count } }
        tagProblemCounts {
          advanced { tagName problemsSolved }
          intermediate { tagName problemsSolved }
          fundamental { tagName problemsSolved }
        }
      }
    }
  `;

  try {
    const res = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://leetcode.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({ query, variables: { username: handle } }),
    });

    if (!res.ok) return { error: `LeetCode API returned ${res.status}` };

    const data = await res.json();
    const user = data?.data?.matchedUser;
    if (!user) return { error: `LeetCode user not found: ${handle}` };

    const acStats = user.submitStatsGlobal?.acSubmissionNum ?? [];
    const easy = acStats.find((s: any) => s.difficulty === 'Easy')?.count ?? 0;
    const medium = acStats.find((s: any) => s.difficulty === 'Medium')?.count ?? 0;
    const hard = acStats.find((s: any) => s.difficulty === 'Hard')?.count ?? 0;

    const allTags = [
      ...(user.tagProblemCounts?.fundamental ?? []),
      ...(user.tagProblemCounts?.intermediate ?? []),
      ...(user.tagProblemCounts?.advanced ?? []),
    ]
      .sort((a: any, b: any) => b.problemsSolved - a.problemsSolved)
      .slice(0, 10)
      .map((t: any) => ({ tag: t.tagName, count: t.problemsSolved }));

    return {
      handle,
      platform: 'leetcode',
      ranking: user.profile?.ranking ?? null,
      totalSolved: easy + medium + hard,
      easySolved: easy,
      mediumSolved: medium,
      hardSolved: hard,
      topTags: allTags,
    };
  } catch (err: any) {
    return { error: err.message };
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const authUser = await getAuthUser();
    if (!authUser) return unauthorized();

    const rl = rateLimit(`scrape:${authUser.userId}`, RATE_LIMITS.scrape);
    if (!rl.allowed) return tooManyRequests(rl.resetAt);

    const { platform, handle: rawHandle } = await req.json();
    if (!platform || !rawHandle?.trim()) {
      return NextResponse.json({ error: 'platform and handle are required' }, { status: 400 });
    }

    const handle = extractHandle(rawHandle, platform);

    let result: any;
    if (platform === 'codeforces') {
      result = await scrapeCodeforces(handle);
    } else if (platform === 'leetcode') {
      result = await scrapeLeetCode(handle);
    } else {
      return NextResponse.json({ error: `Unsupported platform: ${platform}` }, { status: 400 });
    }

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Extract internal code samples before sending response
    const codeSamples = result._codeSamples;
    delete result._codeSamples;

    // ── RAG Ingestion: Feed actual code + topic data into UserTopicProfile ────
    if (result.topTags && result.topTags.length > 0) {
      ingestTopicProfiles(authUser.userId, result.topTags, platform, handle, result.rating, codeSamples).catch((e) => {
        console.warn('[RAG Ingest] Failed:', e instanceof Error ? e.message : e);
      });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
