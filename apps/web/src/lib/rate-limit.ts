/**
 * Simple in-memory rate limiter for API routes.
 *
 * In production, use Redis-based rate limiting (e.g., @upstash/ratelimit).
 * For now, this in-memory implementation prevents basic abuse.
 *
 * Usage:
 *   import { rateLimit } from '@/lib/rate-limit';
 *
 *   const allowed = rateLimit(req, { windowMs: 60000, max: 10 });
 *   if (!allowed) return tooManyRequests();
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetTime < now) store.delete(key);
  }
}

/**
 * Check if a request is within the rate limit.
 * Returns true if allowed, false if rate limited.
 */
export function rateLimit(
  identifier: string,
  options: { windowMs: number; max: number }
): { allowed: boolean; remaining: number; resetAt: number } {
  cleanup();

  const now = Date.now();
  const resetTime = now + options.windowMs;

  const entry = store.get(identifier);

  if (!entry || entry.resetTime < now) {
    store.set(identifier, { count: 1, resetTime });
    return { allowed: true, remaining: options.max - 1, resetAt: resetTime };
  }

  if (entry.count >= options.max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetTime };
  }

  entry.count++;
  return { allowed: true, remaining: options.max - entry.count, resetAt: entry.resetTime };
}

/**
 * Rate limit presets for different route types.
 */
export const RATE_LIMITS = {
  // AI hint generation — expensive, limit to 20/minute
  hint: { windowMs: 60 * 1000, max: 20 },
  // Settings — save/load, limit to 30/minute
  settings: { windowMs: 60 * 1000, max: 30 },
  // Code execution — CPU intensive, limit to 10/minute
  execute: { windowMs: 60 * 1000, max: 10 },
  // Problem scraping — network intensive, limit to 5/minute
  scrape: { windowMs: 60 * 1000, max: 5 },
  // RAG seed code — embedding, limit to 10/minute
  seed: { windowMs: 60 * 1000, max: 10 },
};

/**
 * Standard rate limit exceeded response.
 */
export function tooManyRequests(resetAt: number) {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
  return Response.json(
    {
      error: "RATE_LIMITED",
      message: `Too many requests. Try again in ${retryAfter} seconds.`,
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    }
  );
}
