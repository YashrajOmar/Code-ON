import { NextRequest, NextResponse } from 'next/server';
import {
  parseCFProblemHtml,
  parseCFEditorialHtml,
  extractCFProblemId,
  extractProblemSection,
  postProcessScrapedProblem,
  mapToPublicScrapedProblemDTO,
  ScrapedProblemSchema,
} from '@codeon/scrapers';
import { ProblemScraperService } from '@codeon/scrapers';
import { getActiveProvider } from '@/lib/ai-providers';
import { prisma } from '@/lib/prisma';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// SSE subscribers (shared with companion route)
type Subscriber = (data: any) => void;

export async function POST(req: NextRequest) {
  try {
    const { url, html, editorialHtml } = await req.json();

    if (!url || !html) {
      return NextResponse.json({ error: 'url and html are required' }, { status: 400, headers: corsHeaders });
    }

    const parsed = extractCFProblemId(url);
    if (!parsed) {
      return NextResponse.json({ error: 'Could not extract problem from URL' }, { status: 400, headers: corsHeaders });
    }

    const { contestId, index } = parsed;

    // 1. Fetch CF API metadata (not blocked by Cloudflare)
    let cfProblem: { name?: string; rating?: number; tags?: string[] } = {};
    try {
      const apiUrl = `https://codeforces.com/api/problemset.problems?tags=`;
      const apiRes = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
      if (apiRes.ok) {
        const data = (await apiRes.json()) as any;
        if (data.status === 'OK' && data.result) {
          const found = data.result.problems.find(
            (p: any) => String(p.contestId) === contestId && p.index === index,
          );
          if (found) {
            cfProblem = { name: found.name, rating: found.rating, tags: found.tags || [] };
          }
        }
      }
    } catch {}

    // 2. Parse problem HTML from the bookmarklet
    const pageData = parseCFProblemHtml(html);

    if (!pageData.statement || pageData.statement.trim().length < 10) {
      return NextResponse.json({ error: 'Could not extract problem statement from HTML' }, { status: 422, headers: corsHeaders });
    }

    // 3. Parse editorial HTML if provided
    let editorialMarkdown: string | undefined;
    if (editorialHtml) {
      editorialMarkdown = parseCFEditorialHtml(editorialHtml);
      if (editorialMarkdown && editorialMarkdown.length > 500) {
        const extracted = extractProblemSection(editorialMarkdown, contestId, index);
        if (extracted.length > 100) {
          editorialMarkdown = extracted;
        }
      }
    }

    // 4. AI structuring of editorial (if API key available)
    if (editorialMarkdown && editorialMarkdown.length > 20) {
      try {
        const provider = await getActiveProvider();
        if (provider) {
          const prompt = `You are given a raw editorial for a competitive programming problem. Clean it up into well-structured markdown with clear sections. Remove any navigation links, author info, or page headers. Keep only the actual editorial content.\n\nProblem: ${cfProblem.name || `Problem ${contestId}${index}`}\nRaw editorial:\n${editorialMarkdown.substring(0, 3000)}\n\nOutput ONLY the cleaned editorial in markdown. Structure it as:\n## Approach\n(explain the approach)\n\n## Complexity\n(time and space complexity)`;

          if (provider.format === 'gemini') {
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey: provider.apiKey });
            const response = await ai.models.generateContent({ model: provider.model, contents: prompt });
            if (response.text && response.text.trim().length > 50) editorialMarkdown = response.text.trim();
          } else if (provider.format === 'openai') {
            const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
            const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
              body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 2000 }),
              signal: AbortSignal.timeout(30000),
            });
            if (res.ok) {
              const data = await res.json();
              const text = data.choices?.[0]?.message?.content;
              if (text && text.trim().length > 50) editorialMarkdown = text.trim();
            }
          }
        }
      } catch {}
    }

    // 5. Build ScrapedProblem
    const problem = {
      id: `${contestId}${index}`,
      url,
      platform: 'codeforces' as const,
      title: cfProblem.name || `Problem ${contestId}${index}`,
      isInteractive: cfProblem.tags?.includes('interactive') ?? false,
      content: {
        problemStatementMarkdown:
          pageData.statement +
          (pageData.inputFormat ? `\n\n${pageData.inputFormat}` : '') +
          (pageData.outputFormat ? `\n\n${pageData.outputFormat}` : ''),
        constraintsMarkdown:
          `- **Time Limit:** ${pageData.timeLimitMs ? pageData.timeLimitMs / 1000 + ' seconds' : 'Unknown'}\n` +
          `- **Memory Limit:** ${pageData.memoryLimitKb ? pageData.memoryLimitKb / 1024 + ' MB' : 'Unknown'}`,
        editorialMarkdown,
      },
      examples: pageData.examples.map((ex: any, i: number) => ({
        testId: i + 1,
        input: ex.input,
        output: ex.output,
      })),
    };

    // 6. Post-process + validate
    const cleaned = postProcessScrapedProblem(problem as any);
    const validated = ScrapedProblemSchema.parse(cleaned);
    const dto = mapToPublicScrapedProblemDTO(validated);

    // 7. Save to DB
    try {
      const service = new ProblemScraperService(prisma);
      await service.saveProblem('codeforces', url, validated, 0);
    } catch (e) {
      console.warn('[Bookmarklet] DB save failed:', e);
    }

    // 8. Broadcast via SSE (reuse companion route's subscriber set)
    // The CompanionNotifier component is already listening for SSE events
    // We need to import the subscribers from the companion route
    // Since they're in a different module, we'll use a global approach
    try {
      const { broadcastProblem } = await import('@/lib/sse-broadcast');
      broadcastProblem(dto);
    } catch {
      // SSE broadcast module not available — the parse route still returns the problem
    }

    return NextResponse.json({
      success: true,
      problem: dto,
      message: `Problem "${dto.title}" imported successfully!`,
    }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[Bookmarklet Route] Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to parse' },
      { status: 500, headers: corsHeaders },
    );
  }
}
