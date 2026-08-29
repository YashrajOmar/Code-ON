import type { IProblemScraper, ProblemScrapeResult, ProblemScraperOptions } from '../types';
import { renderPage } from '../renderer';
import { extractProblemFromHtml } from '../sanitizer';

export class GenericProblemScraper implements IProblemScraper {
  readonly platform = 'generic';

  canHandle(url: string): boolean {
    // Dedicated scrapers handle leetcode and codeforces.
    // Generic scraper handles supported CP platforms via Playwright + Gemini.
    return /atcoder\.jp|cses\.fi|kattis\.com|codechef\.com|spoj\.com|usaco\.org/i.test(url);
  }

  async scrapeProblem(url: string, opts?: ProblemScraperOptions): Promise<ProblemScrapeResult> {
    try {
      // Platform detection logic based on URL
      let platform = 'unknown';
      if (url.includes('leetcode.com')) platform = 'leetcode';
      else if (url.includes('codeforces.com')) platform = 'codeforces';
      else if (url.includes('atcoder.jp')) platform = 'atcoder';
      else platform = new URL(url).hostname;

      opts?.onProgress?.('Rendering page via Playwright...');
      const html = await renderPage(url);
      
      opts?.onProgress?.('Extracting problem statement & examples via Gemini...');
      const problem = await extractProblemFromHtml(html, { 
        url, 
        platform, 
        apiKey: opts?.apiKey, 
        model: opts?.model 
      });

      return { problem, error: null };
    } catch (e: any) {
      if (e?.type === 'SSRFBlockedError') {
        return { problem: null, error: { type: 'SSRFBlockedError', message: 'Navigation blocked: SSRF protection triggered.' } };
      }
      return { problem: null, error: { type: 'ValidationError', message: e.message || String(e), details: e } };
    }
  }
}
