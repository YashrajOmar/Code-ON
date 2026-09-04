import { NextRequest, NextResponse } from 'next/server';
import {
  extractCFProblemId,
  postProcessScrapedProblem,
  mapToPublicScrapedProblemDTO,
  ScrapedProblemSchema,
  ProblemScraperService,
} from '@codeon/scrapers';
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

// Strip HTML to plain text without cheerio (cheerio not in apps/web dependencies)
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/&/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/"/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
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
    let cfProblem: { name?: string; rating?: number; tags?: string[]; timeLimit?: number; memoryLimit?: number } = {};
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
            cfProblem = {
              name: found.name,
              rating: found.rating,
              tags: found.tags || [],
              timeLimit: found.timeLimit,
              memoryLimit: found.memoryLimit,
            };
          }
        }
      }
    } catch {}

    // 2. The bookmarklet sends the .problem-statement div HTML.
    // Save it DIRECTLY — do NOT convert to markdown (mangles LaTeX).
    // The frontend's ProblemStatementView renders raw HTML via rehypeRaw + remarkMath + rehypeKatex.
    const statementHtml = html;

    if (!statementHtml || statementHtml.trim().length < 20) {
      return NextResponse.json({ error: 'Could not extract problem statement from HTML' }, { status: 422, headers: corsHeaders });
    }

    // 3. Extract examples from the HTML (simple regex, no cheerio needed)
    const examples: Array<{ input: string; output: string }> = [];
    // CF examples are in .input pre and .output pre
    const inputMatches = statementHtml.match(/class="input"[^>]*>[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/gi) || [];
    const outputMatches = statementHtml.match(/class="output"[^>]*>[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/gi) || [];

    for (let i = 0; i < Math.min(inputMatches.length, outputMatches.length); i++) {
      const inputHtml = inputMatches[i].match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1] || '';
      const outputHtml = outputMatches[i].match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1] || '';
      const cleanInput = inputHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+(>|$)/g, '').replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&').replace(/\n{2,}/g, '\n').trim();
      const cleanOutput = outputHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+(>|$)/g, '').replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&').replace(/\n{2,}/g, '\n').trim();
      if (cleanInput || cleanOutput) {
        examples.push({ input: cleanInput, output: cleanOutput });
      }
    }

    // 4. AI extract editorial for the SPECIFIC problem (with reference code)
    let editorialMarkdown: string | undefined;

    if (editorialHtml) {
      const provider = await getActiveProvider();
      if (provider) {
        // Strip HTML to plain text (no cheerio needed)
        const plainText = stripHtml(editorialHtml).substring(0, 8000);

        const refCode = referenceSolutions && referenceSolutions.length > 0
          ? referenceSolutions[0].code.substring(0, 1500)
          : '';

        const editorialPrompt = `You are given a Codeforces editorial blog post for contest ${contestId}. It contains editorials for MULTIPLE problems (A, B, C, D, E, F).

CRITICAL INSTRUCTION: Extract ONLY the editorial for Problem ${problemLetter} (${cfProblem.name || 'unknown'}).

The blog post uses headers or links like:
- "Problem A" or "116A" or "A - Tram" or a link to /contest/116/problem/A
- "Problem E" or "116E" or "E - Tram" or a link to /contest/116/problem/E

You MUST find the section for Problem ${problemLetter}. Do NOT give me Problem A if I asked for Problem ${problemLetter}.

Format as clean markdown:
## Approach
(explain the approach for Problem ${problemLetter} only)

## Complexity
(time and space complexity)

## Reference Solution
${refCode ? '```cpp\n' + refCode + '\n```' : '(no reference solution was provided)'}

Plain text of the editorial blog post:
${plainText}

Output ONLY the editorial for Problem ${problemLetter}. If Problem ${problemLetter} is genuinely not mentioned, output: "Editorial not available for Problem ${problemLetter}."`;

        const aiEditorial = await aiCall(provider, editorialPrompt);
        if (aiEditorial) editorialMarkdown = aiEditorial;
      }
    }

    // 5. Build ScrapedProblem — RAW HTML for statement
    const problem = {
      id: problemId,
      url,
      platform: 'codeforces' as const,
      title: cfProblem.name || `Problem ${problemId}`,
      isInteractive: cfProblem.tags?.includes('interactive') ?? false,
      content: {
        problemStatementMarkdown: statementHtml,
        constraintsMarkdown:
          `- **Time Limit:** ${cfProblem.timeLimit ? cfProblem.timeLimit + ' seconds' : 'Unknown'}\n` +
          `- **Memory Limit:** ${cfProblem.memoryLimit ? cfProblem.memoryLimit + ' MB' : 'Unknown'}`,
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
