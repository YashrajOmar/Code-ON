/**
 * @codeon/scrapers — barrel export.
 */

// Types
export type {
  ScrapedSubmission,
  SubmissionScrapeResult,
  ScrapedProblem,
  ProblemScrapeResult as LegacyProblemScrapeResult,
  ISubmissionScraper,
  IProblemScraper,
  PublicScrapedProblemDTO,
} from './types';
export {
  ScrapedProblemSchema,
  mapToPublicScrapedProblemDTO
} from './types';

// Service layer & Distributed Lock
export { ProblemScraperService } from './service';
export { DistributedLock } from './lock';

// Platform scrapers
export { CodeforcesSubmissionScraper } from './platforms/codeforces-submissions';
export { LeetCodeSubmissionScraper } from './platforms/leetcode-submissions';
export { LeetCodeProblemScraper } from './platforms/leetcode-problems';
export { CodeforcesProblemScraper } from './platforms/codeforces-problems';
export {
  parseCFProblemHtml,
  parseCFEditorialHtml,
  extractCFProblemId,
  extractProblemSection,
  extractSpecificEditorialHtml,
} from './platforms/codeforces-problems';
export type { CFProblemParseResult } from './platforms/codeforces-problems';
export { GenericProblemScraper } from './platforms/generic-problems';

// Registry v2 — typed failure states + cache port
export { ScraperRegistry } from './registry';
export type {
  ProblemScrapeResult,
  ProblemScrapeSuccess,
  ProblemScrapeBlocked,
  ProblemScrapeNotFound,
  ProblemScrapeError,
  ProblemScrapeClassifiedResult,
  ProblemCachePort,
} from './registry';

// Sync job v2 — tiered backfill
export { SubmissionSyncJob } from './sync-job';
export type {
  LinkedProfile,
  SyncRepository,
  SyncResult,
  SyncJobResult,
  Tier1Result,
} from './sync-job';

// Problem auto-classifier
export { tagProblemTopics, CANONICAL_SLUGS } from './classifier';
export type {
  TopicTag,
  ClassificationResult,
  LlmCall,
  TopicSlug,
} from './classifier';

// Competitive Companion
export { parseCompanionPayload, detectPlatformFromUrl } from './companion';
export type { CompanionPayload, CompanionTest } from './companion';
export { startCompanionListener } from './companion-listener';
export type { CompanionListenerOptions } from './companion-listener';

// Hybrid Markdown
export { createTurndownService, htmlToHybridMarkdown } from './markdown';

// Server-side page rendering (Playwright + SSRF protection)
export { renderPage } from './renderer';

// Deterministic post-processing for LLM-extracted problem data
export {
  postProcessExtraction,
  postProcessScrapedProblem,
  decodeHtmlEntities,
  stripExamplesFromStatement,
  normalizeExampleField,
  normalizeMarkdown,
} from './post-process';


