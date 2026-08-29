import http from 'http';
import { parseCompanionPayload } from './companion';
import { ScrapedProblem } from './types';

export interface CompanionListenerOptions {
  ports?: number[];
  targetApiUrl?: string;
  onProblemReceived?: (problem: ScrapedProblem) => void;
}

const DEFAULT_PORTS = [10043, 4244, 6174, 10045];

/**
 * Starts an HTTP server on standard Competitive Companion ports (10043, etc.)
 * that receives problem payloads from the browser extension and forwards them
 * to the CodeON web API.
 */
export function startCompanionListener(options: CompanionListenerOptions = {}) {
  const ports = options.ports && options.ports.length > 0 ? options.ports : DEFAULT_PORTS;
  const targetApiUrl = options.targetApiUrl || 'http://localhost:3000/api/companion';

  let currentPortIndex = 0;
  let activeServer: http.Server | null = null;

  function tryListen(portIndex: number) {
    if (portIndex >= ports.length) {
      console.warn(
        `[Competitive Companion] Could not bind to any of the ports (${ports.join(', ')}). Extension requests will use direct Next.js /api/companion endpoint instead.`
      );
      return;
    }

    const port = ports[portIndex];
    const server = http.createServer(async (req, res) => {
      // Handle CORS preflight
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
          // Safeguard against unbounded large bodies
          if (body.length > 10 * 1024 * 1024) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Payload Too Large' }));
            req.destroy();
          }
        });

        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body);
            console.log(`[Competitive Companion] Received "${parsed?.name}" on port ${port}`);

            // 1. Convert to ScrapedProblem
            const scrapedProblem = parseCompanionPayload(parsed);
            if (options.onProblemReceived) {
              options.onProblemReceived(scrapedProblem);
            }

            // 2. Forward to Next.js API route if reachable
            try {
              const fetchResponse = await fetch(targetApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(parsed),
              });
              if (!fetchResponse.ok) {
                console.warn(`[Competitive Companion] Target API returned ${fetchResponse.status}`);
              }
            } catch (forwardErr) {
              // Non-blocking forward error
              console.warn('[Competitive Companion] Forwarding to Next.js API failed (web app might still be starting):', forwardErr);
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, problem: scrapedProblem.title }));
          } catch (err: any) {
            console.error('[Competitive Companion] Failed to parse payload:', err);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err?.message || 'Invalid payload' }));
          }
        });
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('CodeON Competitive Companion Listener is running.');
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[Competitive Companion] Port ${port} is in use, trying next port...`);
        tryListen(portIndex + 1);
      } else {
        console.error(`[Competitive Companion] Error on port ${port}:`, err);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      activeServer = server;
      console.log(`⚡ [Competitive Companion] CodeON receiver listening on http://127.0.0.1:${port}`);
    });
  }

  tryListen(0);

  return {
    stop: () => {
      if (activeServer) {
        activeServer.close();
        activeServer = null;
      }
    },
  };
}

// Standalone execution support
startCompanionListener();
