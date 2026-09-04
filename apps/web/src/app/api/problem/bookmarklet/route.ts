import { NextRequest, NextResponse } from 'next/server';
import {
  extractCFProblemId,
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

// ── AI call helper ────────────────────────────────────────────────────────────
async function aiCall(provider: any, prompt: string): Promise<string | null> {
  try {
    if (provider.format === 'gemini') {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: provider.apiKey });
      const response = await ai.models.generateContent({ model: provider.model, contents: prompt });
      return response.text && response.text.trim().length > 20 ? response.text.trim() : null;
    }
    if (provider.format === 'openai') {
      const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 3000 }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        return text && text.trim().length > 20 ? text.trim() : null;
      }
    }
    if (provider.format === 'anthropic') {
      const baseUrl = provider.baseUrl || 'https://api.anthropic.com';
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 3000 }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.content?.[0]?.text;
        return text && text.trim().length > 20 ? text.trim() : null;
      }
    }
  } catch (e) {
    console.warn('[AI Call] Failed:', e);
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { url, html, editorialHtml, referenceSolutions } = await req.json();

    if (!url || !html) {
      return NextResponse.json({ error: 'url and html are required' }, { status: 400, headers: corsHeaders });
    }

    const parsed = extractCFProblemId(url);
    if (!parsed) {
      return NextResponse.json({ error: 'Could not extract problem from URL' }, { status: 400, headers: corsHeaders });
    }

    const { contestId, index } = parsed;
    const problemLetter = index.toUpperCase();
    const problemId = `${contestId}${index}`;

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

    // 2. Extract raw HTML directly from the problem-statement div
    // Do NOT convert to markdown — the frontend's ProblemStatementView uses
    // rehypeRaw + remarkMath + rehypeKatex which handles raw HTML + LaTeX
    let statementHtml = '';
    let timeLimitMs: number | null = null;
    let memoryLimitKb: number | null = null;
    const examples: Array<{ input: string; output: string }> = [];

    try {
      const cheerio = await import('cheerio');
      const $ = cheerio.load(html);
      const statementDiv = $('.problem-statement');

      if (statementDiv.length) {
        // Extract time/memory limits
        const timeLimitStr = statementDiv.find('.time-limit').text();
        timeLimitMs = timeLimitStr ? Math.round(parseFloat(timeLimitStr.match(/([\d.]+)/)?.[1] || '0') * 1000) : null;
        const memoryLimitStr = statementDiv.find('.memory-limit').text();
        memoryLimitKb = memoryLimitStr ? parseInt(memoryLimitStr.match(/(\d+)/)?.[1] || '0', 10) * 1024 : null;

        // Extract examples
        statementDiv.find('.sample-test .input').each((i, el) => {
          const inputHtml = $(el).find('pre').html() || '';
          const outputEl = statementDiv.find('.sample-test .output').eq(i);
          const outputHtml = outputEl.find('pre').html() || '';
          const cleanInput = inputHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim();
          const cleanOutput = outputHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim();
          examples.push({ input: cleanInput, output: cleanOutput });
        });

        // Get raw HTML of the entire problem-statement div
        // This preserves LaTeX math ($...$, $$...$$), images (<img>), tables, etc.
        statementHtml = statementDiv.html() || '';
      }
    } catch (e) {
      console.warn('[Bookmarklet] cheerio parse failed:', e);
    }

    if (!statementHtml || statementHtml.trim().length < 20) {
      return NextResponse.json({ error: 'Could not extract problem statement from HTML' }, { status: 422, headers: corsHeaders });
    }

    // 3. Parse editorial HTML — use cheerio to extract div.ttypography content
    let editorialRawHtml = '';
    if (editorialHtml) {
      try {
        const cheerio = await import('cheerio');
        const $ = cheerio.load(editorialHtml);
        const typo = $('div.ttypography').first();
        if (typo.length) {
          editorialRawHtml = typo.html() || '';
        }
      } catch (e) {
        console.warn('[Bookmarklet] editorial parse failed:', e);
      }
    }

    // 4. AI extract ONLY this problem's editorial from the full blog post
    let editorialMarkdown: string | undefined;
    if (editorialRawHtml && editorialRawHtml.length > 20) {
      const provider = await getActiveProvider();
      if (provider) {
        // Strip HTML to plain text for the AI (smaller payload, faster)
        const cheerio = await import('cheerio');
        const $ = cheerio.load(editorialRawHtml);
        const plainText = $.text().substring(0, 6000);

        const editorialPrompt = `You are given a Codeforces editorial blog post. It contains editorials for MULTIPLE problems from contest ${contestId}.

CRITICAL: Extract ONLY the editorial for Problem ${problemLetter} (${cfProblem.name || 'unknown'}). 

The blog post has sections like:
- "Problem A" or "116A" or "A - Tram"
- "Problem E" or "116E" or "E - Problem Name"

You MUST find Problem ${problemLetter}. Do NOT give me Problem A if I asked for Problem ${problemLetter}.

Also, the user has provided ${referenceSolutions?.length || 0} accepted C++ solutions below. If the editorial mentions code but doesn't include it, reference these solutions.

Format as markdown:
## Approach
(explain the approach for Problem ${problemLetter} only)

## Complexity
(time and space complexity)

## Reference Code
${referenceSolutions && referenceSolutions.length > 0 ? '```cpp\n' + referenceSolutions[0].code.substring(0, 1500) + '\n```' : '(no reference solution provided)'}

Plain text of the editorial blog post:
${plainText}

Output ONLY the editorial for Problem ${problemLetter}. If ${problemLetter} is not mentioned, output: "Editorial not available for Problem ${problemLetter}."`;

        const aiEditorial = await aiCall(provider, editorialPrompt);
        if (aiEditorial) editorialMarkdown = aiEditorial;
      }
    }

    // 5. Build ScrapedProblem — send RAW HTML for statement (not markdown)
    // The frontend's ProblemStatementView handles raw HTML + LaTeX via rehypeRaw
    const problem = {
      id: problemId,
      url,
      platform: 'codeforces' as const,
      title: cfProblem.name || `Problem ${problemId}`,
      isInteractive: cfProblem.tags?.includes('interactive') ?? false,
      content: {
        // Raw HTML — frontend renders it with rehypeRaw + remarkMath + rehypeKatex
        problemStatementMarkdown: statementHtml,
        constraintsMarkdown:
          `- **Time Limit:** ${timeLimitMs ? timeLimitMs / 1000 + ' seconds' : 'Unknown'}\n` +
          `- **Memory Limit:** ${memoryLimitKb ? memoryLimitKb / 1024 + ' MB' : 'Unknown'}`,
        editorialMarkdown,
      },
      examples: examples.map((ex, i) => ({
        testId: i + 1,
        input: ex.input,
        output: ex.output,
      })),
      referenceSolutions: referenceSolutions && referenceSolutions.length > 0
        ? referenceSolutions.map((rs: any) => ({ code: rs.code, language: rs.language || 'cpp', url: rs.url }))
        : undefined,
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

    return NextResponse.json({
      success: true,
      problem: dto,
      message: `Problem "${dto.title}" saved! Go to CodeOn and paste the URL to load it.`,
    }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[Bookmarklet Route] Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to parse' },
      { status: 500, headers: corsHeaders },
    );
  }
}
