import type { PublicScrapedProblemDTO } from '@codeon/scrapers';

type Subscriber = (data: PublicScrapedProblemDTO) => void;

// Global SSE subscriber set — shared between /api/companion and /api/problem/bookmarklet
// Stored on globalThis so it survives across serverless function invocations
const globalForSSE = globalThis as unknown as {
  codeonSSESubscribers?: Set<Subscriber>;
};

if (!globalForSSE.codeonSSESubscribers) {
  globalForSSE.codeonSSESubscribers = new Set<Subscriber>();
}

export const subscribers = globalForSSE.codeonSSESubscribers;

export function addSubscriber(cb: Subscriber) {
  subscribers.add(cb);
}

export function removeSubscriber(cb: Subscriber) {
  subscribers.delete(cb);
}

export function broadcastProblem(dto: PublicScrapedProblemDTO) {
  for (const listener of Array.from(subscribers)) {
    try {
      listener(dto);
    } catch (err) {
      console.warn('[SSE Broadcast] Error for subscriber:', err);
    }
  }
}
