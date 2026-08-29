import { NextRequest, NextResponse } from 'next/server';
import {
  parseCompanionPayload,
  mapToPublicScrapedProblemDTO,
  ProblemScraperService,
  PublicScrapedProblemDTO,
} from '@codeon/scrapers';
import { prisma } from '@/lib/prisma';

// CORS response helper
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

// In-memory SSE broadcast subscribers
type Subscriber = (data: PublicScrapedProblemDTO) => void;
const subscribers = new Set<Subscriber>();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body || !body.name || !body.url) {
      return NextResponse.json(
        { error: 'Invalid payload: "name" and "url" are required fields' },
        { status: 400, headers: corsHeaders }
      );
    }

    // 1. Transform Competitive Companion payload into ScrapedProblem
    const scrapedProblem = parseCompanionPayload(body);

    // 2. Persist to database so it's cached and queryable
    try {
      const service = new ProblemScraperService(prisma);
      await service.saveProblem(scrapedProblem.platform, scrapedProblem.url, scrapedProblem, 0);
    } catch (dbErr) {
      console.error('[Companion API] Database persist warning:', dbErr);
    }

    const publicDto = mapToPublicScrapedProblemDTO(scrapedProblem);

    // 3. Broadcast to all active browser SSE listeners
    for (const listener of Array.from(subscribers)) {
      try {
        listener(publicDto);
      } catch (err) {
        console.warn('[Companion API] Broadcast error for subscriber:', err);
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Problem received and broadcasted successfully',
        data: publicDto,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('[Companion API] Error processing companion POST:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to process Competitive Companion payload' },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // 1. Send initial handshake
      controller.enqueue(encoder.encode(`event: connected\ndata: {"status":"connected"}\n\n`));

      // 2. Setup broadcaster callback
      const onNewProblem: Subscriber = (problemData) => {
        try {
          controller.enqueue(
            encoder.encode(`event: problem\ndata: ${JSON.stringify(problemData)}\n\n`)
          );
        } catch {
          // Controller might be closed
        }
      };

      subscribers.add(onNewProblem);

      // 3. Keep-alive heartbeat every 15s to prevent socket timeouts
      const heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(heartbeatTimer);
        }
      }, 15000);

      cleanup = () => {
        subscribers.delete(onNewProblem);
        clearInterval(heartbeatTimer);
      };

      // 4. Clean up immediately on request abort to prevent memory leaks
      req.signal.addEventListener('abort', () => {
        if (cleanup) {
          cleanup();
          cleanup = null;
        }
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
