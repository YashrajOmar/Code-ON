/**
 * @codeon/scrapers — shared types for all platform scrapers.
 *
 * Every scraper (Codeforces, LeetCode, AtCoder) must return data
 * in these standard shapes so the sync job can insert them into
 * user_submissions and scraped_problems without platform-specific logic.
 */

// ── Submission Scraper Types ──────────────────────────────────────────────────

/** A single submission pulled from a user's public profile. */
export interface ScrapedSubmission {
  /** Platform-specific submission ID (string for portability). */
  platformSubmissionId: string;
  problemSlug: string;
  problemTitle: string;
  problemUrl: string;
  language: string;
  /** The actual source code. May be empty if platform doesn't expose it publicly. */
  code: string;
  verdict: 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'UNKNOWN';
  runtimeMs: number | null;
  memoryKb: number | null;
  problemDifficulty: string | null;
  submittedAt: Date;
}

/** Result of scraping a user's submission history. */
export interface SubmissionScrapeResult {
  platform: string;
  username: string;
  submissions: ScrapedSubmission[];
  /** Number of submissions we attempted to fetch. */
  totalAvailable: number | null;
  /** If the scraper hit a rate limit or error, record it. */
  error: string | null;
}

// ── Problem Scraper Types ─────────────────────────────────────────────────────

import { z } from 'zod';

// Every other string field in this schema is bounded — to ensure no single string 
// or a single key inside interactiveSecretState can hold a massive payload.
const Primitive = z.union([z.string().max(50_000), z.number(), z.boolean(), z.null()]);
// Arrays inside interactiveSecretState MUST be bounded to prevent array-flooding
const BoundedArray = z.array(Primitive).max(500);

// Schema specifically for Gemini's structured output
export const GeminiExtractionSchema = z.object({
  title: z.string().max(10_000),
  isInteractive: z.boolean().default(false),
  problemStatementMarkdown: z.string().max(100_000),
  constraintsMarkdown: z.string().max(20_000).optional(),
  editorialMarkdown: z.string().max(100_000).optional(),
  examples: z.array(
    z.object({
      testId: z.number(),
      input: z.string().max(50_000),
      output: z.string().max(50_000),
      explanation: z.string().max(50_000).optional(),
    })
  ).max(50),
});

export type GeminiExtraction = z.infer<typeof GeminiExtractionSchema>;

export const ScrapedProblemSchema = z.object({
  id: z.string().max(10_000),
  title: z.string().max(10_000),
  url: z.string().url(),
  platform: z.string(),
  isInteractive: z.boolean(),
  content: z.object({
    problemStatementMarkdown: z.string().max(100_000),
    constraintsMarkdown: z.string().max(20_000).optional(),
    editorialMarkdown: z.string().max(100_000).optional()
  }),
  examples: z.array(z.object({
    testId: z.number(),
    input: z.string().max(50_000),
    output: z.string().max(50_000),
    explanation: z.string().max(50_000).optional(),
    // Strictly limit key count and array bounds
    interactiveSecretState: z.record(z.union([Primitive, BoundedArray]))
      .optional()
      .refine(
        (obj) => !obj || Object.keys(obj).length <= 20,
        { message: 'Too many keys in interactiveSecretState (max 20)' }
      )
  })).max(50),
  referenceSolutions: z.array(z.object({
    code: z.string().max(100_000),
    language: z.string(),
    url: z.string().url()
  })).max(10).optional(),
});

/** A problem page scraped from a URL. */
export type ScrapedProblem = z.infer<typeof ScrapedProblemSchema>;

export type PublicScrapedProblemDTO = Omit<ScrapedProblem, 'examples'> & {
  examples: Array<Omit<ScrapedProblem['examples'][0], 'interactiveSecretState'>>;
};

/**
 * Strips internal state from a scraped problem so it's safe to send to the browser.
 */
export function mapToPublicScrapedProblemDTO(problem: ScrapedProblem): PublicScrapedProblemDTO {
  return {
    ...problem,
    examples: problem.examples.map(ex => {
      const { interactiveSecretState, ...rest } = ex;
      return rest;
    })
  };
}

export type ScraperError =
  | { type: 'BotProtectionError'; message: string }
  | { type: 'TimeoutError'; message: string; stage: string }
  | { type: 'ValidationError'; message: string; details: any }
  | { type: 'SSRFBlockedError'; message: string }
  | { type: 'CacheError'; message: string }
  | { type: 'AIQuotaExceededError'; message: string }
  | { type: 'UnsupportedWebsiteError'; message: string }
  | { type: 'FencingTokenLostError'; message: string; canonicalData: any };

/** Result of scraping a problem page. */
export interface ProblemScrapeResult {
  problem: ScrapedProblem | null;
  error: ScraperError | null;
}

// ── Scraper Interface ─────────────────────────────────────────────────────────

/**
 * Every platform submission scraper must implement this interface.
 * The sync job calls `scrapeSubmissions` with the public username
 * and an optional cursor for incremental sync.
 */
export interface ISubmissionScraper {
  readonly platform: string;

  /**
   * Scrape a user's public submission history.
   * @param username - The public username on the platform.
   * @param afterTimestamp - Only fetch submissions after this time (incremental sync).
   */
  scrapeSubmissions(
    username: string,
    afterTimestamp?: Date
  ): Promise<SubmissionScrapeResult>;
}

export interface ProblemScraperOptions {
  apiKey?: string;
  model?: string;
  cacheTtlMs?: number;
  onProgress?: (msg: string) => void;
}

/**
 * Every platform problem scraper must implement this interface.
 * Called when a user pastes a problem URL into the app.
 */
export interface IProblemScraper {
  readonly platform: string;

  /** Returns true if this scraper can handle the given URL. */
  canHandle(url: string): boolean;

  /** Scrape the problem page at the given URL. */
  scrapeProblem(url: string, opts?: ProblemScraperOptions): Promise<ProblemScrapeResult>;
}

