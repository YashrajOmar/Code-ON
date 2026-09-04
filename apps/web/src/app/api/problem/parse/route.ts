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
import { getActiveProvider } from '@/lib/ai-providers';

export async function POST(req: NextRequest) {
  try {
    const { url, problemHtml, editorialHtml, rawText } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // ── Codeforces ──────────────────────────────────────────────────────────
    if (url.includes('codeforces.com')) {
      return parseCodeforces(url, problemHtml, editorialHtml, rawText);
    }

    // ── LeetCode (manual paste fallback) ────────────────────────────────────
    if (url.includes('leetcode.com')) {
      return parseLeetCodeManual(url, rawText);
    }

    return NextResponse.json({ error: 'Unsupported URL' }, { status: 400 });
  } catch (error: any) {
    console.error('[Parse Route] Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to parse' }, { status: 500 });
  }
}

// ── Codeforces parser ──────────────────────────────────────────────────────────

async function parseCodeforces(
  url: string,
  problemHtml: string | undefined,
  editorialHtml: string | undefined,
  rawText: string | undefined,
) {
  const parsed = extractCFProblemId(url);
  if (!parsed) {
    return NextResponse.json({ error: 'Could not extract contest/problem from URL' }, { status: 400 });
  }

  const { contestId, index } = parsed;

  // Step 1: Fetch CF API metadata (name, tags, rating — not blocked by Cloudflare)
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

  // Step 2: Parse problem HTML (from companion or manual paste)
  let pageData;
  if (problemHtml) {
    pageData = parseCFProblemHtml(problemHtml);
  } else if (rawText) {
    // Manual paste of plain text — use directly as statement
    pageData = {
      statement: rawText,
      inputFormat: null,
      outputFormat: null,
      timeLimitMs: null,
      memoryLimitKb: null,
      examples: [],
      tutorialUrl: null,
    };
  } else {
    return NextResponse.json({ error: 'No problemHtml or rawText provided' }, { status: 400 });
  }

  if (!pageData.statement || pageData.statement.trim().length < 10) {
    return NextResponse.json({ error: 'Could not extract problem statement from the provided HTML' }, { status: 422 });
  }

  // Step 3: Parse editorial HTML if provided
  let editorialMarkdown: string | undefined;
  if (editorialHtml) {
    const parsed = parseCFEditorialHtml(editorialHtml);
    if (parsed) {
      editorialMarkdown = parsed;
      // Extract only this problem's section from the full contest editorial
      if (editorialMarkdown.length > 500) {
        const extracted = extractProblemSection(editorialMarkdown, contestId, index);
        if (extracted.length > 100) {
          editorialMarkdown = extracted;
        }
      }
    }
  }

  // Step 4: AI structuring of editorial (if API key available)
  if (editorialMarkdown && editorialMarkdown.length > 20) {
    try {
      const structured = await aiStructureEditorial(
        cfProblem.name || `Problem ${contestId}${index}`,
        editorialMarkdown,
      );
      if (structured) editorialMarkdown = structured;
    } catch {}
  }

  // Step 5: Build ScrapedProblem
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

  // Step 6: Post-process + validate
  try {
    const cleaned = postProcessScrapedProblem(problem as any);
    const validated = ScrapedProblemSchema.parse(cleaned);
    const dto = mapToPublicScrapedProblemDTO(validated);

    return NextResponse.json({
      problem: dto,
      tutorialUrl: pageData.tutorialUrl && !editorialHtml ? pageData.tutorialUrl : undefined,
    });
  } catch (e) {
    return NextResponse.json({ error: `Validation error: ${e instanceof Error ? e.message : String(e)}` }, { status: 422 });
  }
}

// ── LeetCode manual paste ────────────────────────────────────────────────────

function parseLeetCodeManual(url: string, rawText: string | undefined) {
  if (!rawText || rawText.trim().length < 10) {
    return NextResponse.json({ error: 'No text provided for manual paste' }, { status: 400 });
  }

  // Extract slug for the title
  const slugMatch = url.match(/leetcode\.com\/problems\/([a-z0-9-]+)/i);
  const slug = slugMatch ? slugMatch[1] : 'unknown';
  const title = slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  // Try to extract examples from the pasted text
  const examples: Array<{ testId: number; input: string; output: string }> = [];
  const exampleRegex = /(?:Example\s*\d*[:\].]?)?\s*(?:Input:?)\s*([\s\S]*?)(?:Output:?)\s*([\s\S]*?)(?=(?:Example|$))/gi;
  let m;
  let i = 1;
  while ((m = exampleRegex.exec(rawText)) !== null && i <= 10) {
    const input = m[1].trim();
    const output = m[2].trim();
    if (input && output) {
      examples.push({ testId: i++, input, output });
    }
  }

  const problem = {
    id: slug,
    url,
    platform: 'leetcode' as const,
    title,
    isInteractive: false,
    content: {
      problemStatementMarkdown: rawText,
      constraintsMarkdown: undefined,
      editorialMarkdown: undefined,
    },
    examples,
  };

  try {
    const cleaned = postProcessScrapedProblem(problem as any);
    const validated = ScrapedProblemSchema.parse(cleaned);
    const dto = mapToPublicScrapedProblemDTO(validated);
    return NextResponse.json({ problem: dto });
  } catch (e) {
    return NextResponse.json({ error: `Validation error: ${e instanceof Error ? e.message : String(e)}` }, { status: 422 });
  }
}

// ── AI editorial structuring (reused from scrape route) ──────────────────────

async function aiStructureEditorial(title: string, rawEditorial: string): Promise<string | null> {
  try {
    const provider = await getActiveProvider();
    if (!provider) return null;

    const prompt = `You are given a raw editorial for a competitive programming problem. Clean it up into well-structured markdown with clear sections. Remove any navigation links, author info, or page headers. Keep only the actual editorial content.

Problem: ${title}
Raw editorial:
${rawEditorial.substring(0, 3000)}

Output ONLY the cleaned editorial in markdown. Structure it as:
## Approach
(explain the approach)

## Complexity
(time and space complexity)

If there's code in the editorial, format it in proper code blocks.`;

    if (provider.format === 'gemini') {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: provider.apiKey });
      const response = await ai.models.generateContent({ model: provider.model, contents: prompt });
      const text = response.text;
      if (text && text.trim().length > 50) return text.trim();
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
        if (text && text.trim().length > 50) return text.trim();
      }
    } else if (provider.format === 'anthropic') {
      const baseUrl = provider.baseUrl || 'https://api.anthropic.com';
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 2000 }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.content?.[0]?.text;
        if (text && text.trim().length > 50) return text.trim();
      }
    }
  } catch {}
  return null;
}
