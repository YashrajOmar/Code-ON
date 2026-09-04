import { NextRequest, NextResponse } from 'next/server';
import {
  parseCFProblemHtml,
  parseCFEditorialHtml,
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

// ── AI call helper (works with Gemini, OpenAI, Anthropic) ────────────────────
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

    // 2. Parse problem HTML from the bookmarklet (raw cheerio parse)
    const pageData = parseCFProblemHtml(html);

    if (!pageData.statement || pageData.statement.trim().length < 10) {
      return NextResponse.json({ error: 'Could not extract problem statement from HTML' }, { status: 422, headers: corsHeaders });
    }

    // 3. Get AI provider (user's API key from Settings)
    const provider = await getActiveProvider();

    // 4. AI format the problem statement (fix markdown, preserve images, clean up)
    let statementMarkdown =
      pageData.statement +
      (pageData.inputFormat ? `\n\n${pageData.inputFormat}` : '') +
      (pageData.outputFormat ? `\n\n${pageData.outputFormat}` : '');

    if (provider) {
      const statementPrompt = `You are given a raw Codeforces problem statement (converted from HTML to markdown). Clean it up into well-formatted markdown.

Rules:
- Preserve all images (keep ![image](url) format)
- Preserve math formulas (keep $...$ or $$...$$ format)
- Keep the problem title, legend, input format, output format, and note sections
- Remove any HTML tags, CSS, or JavaScript that leaked through
- Remove any "Codeforces" branding, ads, or navigation elements
- Keep it clean and readable

Problem: ${cfProblem.name || `Problem ${problemId}`}
Raw statement:
${statementMarkdown.substring(0, 4000)}

Output ONLY the cleaned problem statement in markdown.`;

      const aiStatement = await aiCall(provider, statementPrompt);
      if (aiStatement) statementMarkdown = aiStatement;
    }

    // 5. Parse + AI extract editorial for THIS specific problem
    let editorialMarkdown: string | undefined;
    if (editorialHtml) {
      editorialMarkdown = parseCFEditorialHtml(editorialHtml);
    }

    if (editorialMarkdown && editorialMarkdown.length > 20 && provider) {
      const editorialPrompt = `You are given a raw Codeforces editorial blog post. It contains editorials for MULTIPLE problems (A, B, C, D, E, F) from contest ${contestId}.

CRITICAL INSTRUCTION: You must find and extract ONLY the editorial for Problem ${problemLetter} (${cfProblem.name || 'unknown'}). 

The editorial blog post uses headers like:
- "Problem A" or "116A" or "A - Problem Name" or just "A"
- "Problem E" or "116E" or "E - Problem Name" or just "E"

You MUST scan for Problem ${problemLetter} or ${problemId} specifically. Do NOT give me the editorial for Problem A if I asked for Problem ${problemLetter}.

Discard everything else: announcements, rants, standings, other problems' editorials, author thank-you notes, etc.

Format the extracted editorial as clean markdown:
## Approach
(explain the approach for Problem ${problemLetter} only)

## Complexity
(time and space complexity)

## Code
(if any code is present in the editorial, format it in a cpp code block)

If Problem ${problemLetter} is genuinely not mentioned in this blog post, output: "Editorial not available for Problem ${problemLetter}."

Raw blog post:
${editorialMarkdown.substring(0, 6000)}

Output ONLY the editorial for Problem ${problemLetter}.`;

      const aiEditorial = await aiCall(provider, editorialPrompt);
      if (aiEditorial) editorialMarkdown = aiEditorial;
    }

    // 6. AI format the reference solutions (if provided and AI available)
    let formattedRefSolutions = referenceSolutions && referenceSolutions.length > 0
      ? referenceSolutions.map((rs: any) => ({ code: rs.code, language: rs.language || 'cpp', url: rs.url }))
      : undefined;

    // 7. Build ScrapedProblem
    const problem = {
      id: problemId,
      url,
      platform: 'codeforces' as const,
      title: cfProblem.name || `Problem ${problemId}`,
      isInteractive: cfProblem.tags?.includes('interactive') ?? false,
      content: {
        problemStatementMarkdown: statementMarkdown,
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
      referenceSolutions: formattedRefSolutions,
    };

    // 8. Post-process + validate
    const cleaned = postProcessScrapedProblem(problem as any);
    const validated = ScrapedProblemSchema.parse(cleaned);
    const dto = mapToPublicScrapedProblemDTO(validated);

    // 9. Save to DB
    try {
      const service = new ProblemScraperService(prisma);
      await service.saveProblem('codeforces', url, validated, 0);
    } catch (e) {
      console.warn('[Bookmarklet] DB save failed:', e);
    }

    // 10. Return (NO SSE broadcast — each user sees only their own imports)
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
