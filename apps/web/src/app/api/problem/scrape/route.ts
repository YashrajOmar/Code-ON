import { NextRequest } from 'next/server';
import { ScraperRegistry, ProblemScraperService, mapToPublicScrapedProblemDTO } from '@codeon/scrapers';
import { prisma } from '@/lib/prisma';
import { decryptKey } from '@/lib/crypto';
import { getAuthUser } from '@/lib/auth';
import { getActiveProvider } from '@/lib/ai-providers';

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'URL is required' }), { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // 1. Fetch the AUTHENTICATED user's Gemini API key & model from DB
          let geminiApiKey: string | undefined;
          let geminiModel: string | undefined = 'gemini-2.5-flash';

          const authUser = await getAuthUser();
          if (authUser) {
            try {
              const user = await prisma.user.findUnique({
                where: { id: authUser.userId },
                include: { apiKeys: true },
              });
              if (user?.apiKeys) {
                for (const keyObj of user.apiKeys) {
                  if (keyObj.provider === 'gemini') {
                    const dec = decryptKey(keyObj.encryptedKey);
                    if (dec && dec.trim()) geminiApiKey = dec.trim();
                  } else if (keyObj.provider === 'gemini_model') {
                    const dec = decryptKey(keyObj.encryptedKey);
                    if (dec && dec.trim()) geminiModel = dec.trim();
                  }
                }
              }
            } catch (e) {
              console.warn('[Scrape Route] Could not load API key from DB:', e);
            }
          }

          const service = new ProblemScraperService(prisma);
          const registry = new ScraperRegistry({ cache: service });
          
          const scrapeResult = await registry.scrapeProblem(url.trim(), {
            apiKey: geminiApiKey,
            model: geminiModel,
            onProgress: (msg) => sendEvent('progress', { message: msg })
          });

          if (!scrapeResult.success) {
            // Distinguish BLOCKED (Cloudflare) from generic errors so the
            // frontend can try the Companion app or show manual paste.
            if (scrapeResult.reason === 'BLOCKED') {
              sendEvent('blocked', {
                message: 'Codeforces is blocking automated access (Cloudflare 403). Try the Companion app or paste the problem manually.',
                url: (scrapeResult as any).url,
                requiresManualPaste: true,
              });
            } else {
              const errorMsg = 'error' in scrapeResult ? scrapeResult.error : `Failed: ${(scrapeResult as any).reason}`;
              sendEvent('error', { message: errorMsg || 'Could not scrape problem from the provided URL.' });
            }
            controller.close();
            return;
          }

          const problem = scrapeResult.problem;

          // ── Detect Cloudflare block: success but empty statement ──────────
          if (!problem.content?.problemStatementMarkdown || problem.content.problemStatementMarkdown.trim().length < 20) {
            sendEvent('blocked', {
              message: 'Codeforces is blocking automated access (Cloudflare). Open the problem in your browser, copy the page source, and paste it below.',
              url: url.trim(),
              requiresManualPaste: true,
            });
            controller.close();
            return;
          }

          // ── AI Structuring: Use the user's AI provider to clean up editorial ──
          if (problem.content?.editorialMarkdown && problem.content.editorialMarkdown.length > 20) {
            try {
              const provider = await getActiveProvider();
              if (provider) {
                sendEvent('progress', { message: 'Structuring editorial with AI...' });
                
                const editorialPrompt = `You are given a raw editorial for a competitive programming problem. Clean it up into well-structured markdown with clear sections. Remove any navigation links, author info, or page headers. Keep only the actual editorial content.

Problem: ${problem.title}
Raw editorial:
${problem.content.editorialMarkdown.substring(0, 3000)}

Output ONLY the cleaned editorial in markdown. Structure it as:
## Approach
(explain the approach)

## Complexity
(time and space complexity)

If there's code in the editorial, format it in proper code blocks.`;

                const { GoogleGenAI } = await import('@google/genai');
                if (provider.format === 'gemini') {
                  const ai = new GoogleGenAI({ apiKey: provider.apiKey });
                  const response = await ai.models.generateContent({
                    model: provider.model,
                    contents: editorialPrompt,
                  });
                  const structured = response.text;
                  if (structured && structured.trim().length > 50) {
                    problem.content.editorialMarkdown = structured.trim();
                  }
                } else if (provider.format === 'openai') {
                  const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
                  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
                    body: JSON.stringify({
                      model: provider.model,
                      messages: [{ role: 'user', content: editorialPrompt }],
                      temperature: 0.3,
                      max_tokens: 2000,
                    }),
                    signal: AbortSignal.timeout(30000),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    const structured = data.choices?.[0]?.message?.content;
                    if (structured && structured.trim().length > 50) {
                      problem.content.editorialMarkdown = structured.trim();
                    }
                  }
                } else if (provider.format === 'anthropic') {
                  const baseUrl = provider.baseUrl || 'https://api.anthropic.com';
                  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' },
                    body: JSON.stringify({
                      model: provider.model,
                      messages: [{ role: 'user', content: editorialPrompt }],
                      temperature: 0.3,
                      max_tokens: 2000,
                    }),
                    signal: AbortSignal.timeout(30000),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    const structured = data.content?.[0]?.text;
                    if (structured && structured.trim().length > 50) {
                      problem.content.editorialMarkdown = structured.trim();
                    }
                  }
                }
              }
            } catch (e) {
              console.warn('[Scrape Route] AI structuring failed, using raw editorial:', e);
            }
          }

          if (!scrapeResult.fromCache && scrapeResult.fencingToken !== undefined) {
            try {
              sendEvent('progress', { message: 'Saving to database...' });
              await service.saveProblem(problem.platform, problem.url, problem, scrapeResult.fencingToken);
            } catch (dbError) {
              console.error('Failed to save scraped problem to DB:', dbError);
            }
          }

          const publicProblemDTO = mapToPublicScrapedProblemDTO(problem);
          sendEvent('success', { data: publicProblemDTO });
          controller.close();

        } catch (err: any) {
          sendEvent('error', { message: err?.message || 'Failed to scrape problem' });
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error('Scrape API setup error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Failed to initialize scraper' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
