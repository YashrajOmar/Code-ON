import { NextRequest } from 'next/server';
import { ScraperRegistry, ProblemScraperService, mapToPublicScrapedProblemDTO } from '@codeon/scrapers';
import { prisma } from '@/lib/prisma';
import { decryptKey } from '@/lib/crypto';

const DEMO_USER_EMAIL = 'demo@codeon.dev';

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
          // 1. Fetch user's configured Gemini API key & model from DB
          let geminiApiKey: string | undefined = process.env.GEMINI_API_KEY;
          let geminiModel: string | undefined = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

          try {
            const user = await prisma.user.findUnique({
              where: { email: DEMO_USER_EMAIL },
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
            console.warn('[Scrape Route] Could not load API key from DB, fallback to env:', e);
          }

          const service = new ProblemScraperService(prisma);
          const registry = new ScraperRegistry({ cache: service });
          
          const scrapeResult = await registry.scrapeProblem(url.trim(), {
            apiKey: geminiApiKey,
            model: geminiModel,
            onProgress: (msg) => sendEvent('progress', { message: msg })
          });

          if (!scrapeResult.success) {
            const errorMsg = 'error' in scrapeResult ? scrapeResult.error : `Failed: ${(scrapeResult as any).reason}`;
            sendEvent('error', { message: errorMsg || 'Could not scrape problem from the provided URL.' });
            controller.close();
            return;
          }

          const problem = scrapeResult.problem;

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
