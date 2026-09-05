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
      const response = await ai.models.generateContent({ 
        model: provider.model, 
        contents: prompt,
        config: { maxOutputTokens: 8192 },
      });
      return response.text && response.text.trim().length > 20 ? response.text.trim() : null;
    }
    if (provider.format === 'openai') {
      const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 8192 }),
        signal: AbortSignal.timeout(120000),
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
        body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 8192 }),
        signal: AbortSignal.timeout(120000),
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

// Strip HTML to plain text (no cheerio dependency)
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

    // 1. Fetch CF API metadata
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

    // 2. Get AI provider (user's API key from Settings)
    const provider = await getActiveProvider();

    // 3. Extract examples with regex (no cheerio)
    const examples: Array<{ input: string; output: string }> = [];
    const inputMatches = html.match(/class="input"[^>]*>[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/gi) || [];
    const outputMatches = html.match(/class="output"[^>]*>[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/gi) || [];
    for (let i = 0; i < Math.min(inputMatches.length, outputMatches.length); i++) {
      const inputHtml = inputMatches[i].match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1] || '';
      const outputHtml = outputMatches[i].match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1] || '';
      const cleanInput = inputHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+(>|$)/g, '').replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&').replace(/\n{2,}/g, '\n').trim();
      const cleanOutput = outputHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+(>|$)/g, '').replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&').replace(/\n{2,}/g, '\n').trim();
      if (cleanInput || cleanOutput) examples.push({ input: cleanInput, output: cleanOutput });
    }

    // 4. RUN BOTH AI CALLS IN PARALLEL (prevents Vercel timeout)
    const refCode = referenceSolutions && referenceSolutions.length > 0
      ? referenceSolutions[0].code.substring(0, 1500)
      : '';

    // AI Task 1: Format problem statement (convert $$$ syntax to LaTeX, preserve <pre> blocks)
    const statementPrompt = `Convert this Codeforces problem statement HTML into clean, well-formatted markdown.

CRITICAL RULES:
1. Convert Codeforces inline math (wrapped in $$$) to standard LaTeX (wrapped in $).
   Example: $$$n$$$ → $n$, $$$a_i$$$ → $a_i$
2. Convert Codeforces display math (wrapped in $$$$$$) to display LaTeX (wrapped in $$).
   Example: $$$$$$\\sum_{i=1}^n a_i$$$$$$ → $$\\sum_{i=1}^n a_i$$
3. When you encounter a <pre> or <div class="input"> block, preserve the EXACT line breaks. Do not squash numbers together. Format them as markdown code blocks.
4. Preserve images as ![image](url)
5. Keep sections: problem title, legend, input format, output format, note
6. Remove all remaining HTML tags, CSS classes, JavaScript, MathJax spans
7. Keep markdown structure (headers, lists, bold)

Problem: ${cfProblem.name || `Problem ${problemId}`}
Raw HTML (clean, from server):
${html.substring(0, 6000)}

Output ONLY the formatted problem statement in markdown with proper LaTeX.`;

    // AI Task 2: Extract + format editorial for the SPECIFIC problem
    // Pre-slice: find the problem in the text, start from there (saves tokens + prevents wrong problem)
    let editorialPlainText = '';
    if (editorialHtml) {
      let fullText = stripHtml(editorialHtml);
      
      // Try to find the start of THIS problem's editorial section
      const patterns = [
        `${problemLetter}. ${cfProblem.name || ''}`,  // "I2. DBFS Order"
        `${problemLetter} - ${cfProblem.name || ''}`,  // "I2 - DBFS Order"
        `${problemId} - ${cfProblem.name || ''}`,      // "2237I2 - DBFS Order"
        `${problemId}`,                                  // "2237I2"
        `${cfProblem.name || ''}`,                       // "DBFS Order (Hard Version)"
      ];
      
      let sliceStart = -1;
      for (const pattern of patterns) {
        if (pattern && pattern.length > 2) {
          const idx = fullText.indexOf(pattern);
          if (idx >= 0) {
            sliceStart = idx;
            break;
          }
        }
      }
      
      if (sliceStart > 0) {
        // Start from the problem's section — send MORE text (up to 10000 chars)
        editorialPlainText = fullText.substring(sliceStart, sliceStart + 10000);
      } else {
        // Fallback: send from middle of text (skip intro/announcements)
        const midPoint = Math.floor(fullText.length / 3);
        editorialPlainText = fullText.substring(midPoint, midPoint + 10000);
      }
    }

    const editorialPrompt = `You are extracting the editorial STRICTLY for Problem ${problemLetter} titled "${cfProblem.name || 'unknown'}".

CRITICAL: Do NOT summarize or include information about Problem A, Problem B, or ANY other problem. Ignore the rest of the page. If you see content about other problems, SKIP it.

The text below has been pre-sliced to start near your target problem. Extract ONLY the explanation, complexity, and code for Problem ${problemLetter}.

If you cannot find this specific problem, return exactly: "Editorial not found for Problem ${problemLetter}." Do not guess or return the first problem on the page.

Convert any math notation to proper LaTeX ($...$ or $$...$$).
Format code in proper cpp code blocks.

## Approach
(explain the approach for Problem ${problemLetter} ONLY)

## Complexity
(time and space complexity)

## Reference Solution
${refCode ? '```cpp\n' + refCode + '\n```' : '(no reference solution was provided)'}

Pre-sliced editorial text (starts near Problem ${problemLetter}):
${editorialPlainText}

Output ONLY the editorial for Problem ${problemLetter}.`;

    // Run both AI calls in parallel
    let statementMarkdown = html; // fallback: raw HTML
    let editorialMarkdown: string | undefined;

    if (provider) {
      const [statementResult, editorialResult] = await Promise.allSettled([
        aiCall(provider, statementPrompt),
        editorialHtml ? aiCall(provider, editorialPrompt) : Promise.resolve(null),
      ]);

      if (statementResult.status === 'fulfilled' && statementResult.value) {
        statementMarkdown = statementResult.value;
      }
      if (editorialResult.status === 'fulfilled' && editorialResult.value) {
        editorialMarkdown = editorialResult.value;
      } else {
        // Fallback: don't fail silently — inject default message so frontend doesn't break
        editorialMarkdown = "## Editorial\n\nThe AI could not extract the editorial automatically. Please check the blog link manually.";
      }
    }

    // 5. Build ScrapedProblem
    const problem = {
      id: problemId,
      url,
      platform: 'codeforces' as const,
      title: cfProblem.name || `Problem ${problemId}`,
      isInteractive: cfProblem.tags?.includes('interactive') ?? false,
      content: {
        problemStatementMarkdown: statementMarkdown,
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
