/**
 * Codeforces Problem Scraper.
 *
 * When a user pastes a Codeforces problem URL, this scraper:
 *   1. Extracts the contest ID and problem index from the URL.
 *   2. Uses the Codeforces API to fetch problem metadata.
 *   3. Scrapes the problem page HTML for the full statement
 *      (the API only returns tags and rating, not the statement text).
 *
 * Note: Codeforces does not provide editorials via API. The editorial
 * is typically in a separate blog post. We attempt to find it but
 * editorial_code may be null for many CF problems.
 */

import type { IProblemScraper, ProblemScrapeResult, ScrapedProblem } from '../types';
import * as cheerio from 'cheerio';
import { htmlToHybridMarkdown } from '../markdown';

const htmlToMarkdown = htmlToHybridMarkdown;

// ── URL parsing ───────────────────────────────────────────────────────────────

interface CFProblemId {
  contestId: string;
  index: string;
}

/**
 * Extract contestId and problem index from CF URLs.
 * Supports:
 *   https://codeforces.com/problemset/problem/1/A
 *   https://codeforces.com/contest/1/problem/A
 *   https://codeforces.com/gym/100001/problem/A
 */
function extractCFProblemId(url: string): CFProblemId | null {
  const patterns = [
    /codeforces\.com\/problemset\/problem\/(\d+)\/([A-Za-z]\d?)/i,
    /codeforces\.com\/contest\/(\d+)\/problem\/([A-Za-z]\d?)/i,
    /codeforces\.com\/gym\/(\d+)\/problem\/([A-Za-z]\d?)/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { contestId: match[1], index: match[2].toUpperCase() };
    }
  }
  return null;
}

// ── CF API types ──────────────────────────────────────────────────────────────

interface CFProblemInfo {
  contestId: number;
  index: string;
  name: string;
  rating?: number;
  tags: string[];
  timeLimit?: string;
  memoryLimit?: string;
}

interface CFApiProblemsResponse {
  status: 'OK' | 'FAILED';
  result?: {
    problems: CFProblemInfo[];
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCFProblemStatement(
  contestId: string,
  index: string
): Promise<{ statement: string; inputFormat: string | null; outputFormat: string | null; timeLimitMs: number | null; memoryLimitKb: number | null; examples: Array<{ input: string; output: string }>; tutorialUrl: string | null }> {
  const pageUrl = `https://codeforces.com/problemset/problem/${contestId}/${index}`;
  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  };

  const response = await fetch(pageUrl, { headers: browserHeaders });

  let html = '';

  if (response.ok) {
    html = await response.text();
  }

  // Check if Cloudflare is blocking us (empty HTML, challenge page, or 403)
  if (!html || html.includes('Just a moment') || html.includes('browser is being checked') || html.includes('cf-challenge') || html.includes('Please wait') || !html.includes('problem-statement')) {
    // Try Jina AI reader proxy (bypasses Cloudflare)
    try {
      const jinaRes = await fetch(`https://r.jina.ai/${pageUrl}`, {
        headers: { 'Accept': 'text/html' },
        signal: AbortSignal.timeout(15000),
      });
      if (jinaRes.ok) {
        const jinaText = await jinaRes.text();
        if (jinaText && jinaText.length > 100) {
          // Parse the Jina markdown response into our format
          // Jina returns: Title: ...\nURL Source: ...\nMarkdown Content:\n<actual content>
          const contentStart = jinaText.indexOf('Markdown Content:\n');
          const markdownContent = contentStart >= 0 ? jinaText.substring(contentStart + 18).trim() : jinaText;

          // Extract time/memory limits from markdown
          const timeMatch = markdownContent.match(/(\d+)\s*second/i);
          const memMatch = markdownContent.match(/(\d+)\s*megabyte/i);
          const timeLimitMs = timeMatch ? parseInt(timeMatch[1]) * 1000 : null;
          const memoryLimitKb = memMatch ? parseInt(memMatch[1]) * 1024 : null;

          // Extract examples (Input/Output pairs)
          const examples: Array<{ input: string; output: string }> = [];
          const exampleRegex = /(?:Input|input)\s*\n\s*([^\n]+)\s*\n\s*(?:Output|output)\s*\n\s*([^\n]+)/g;
          let exMatch;
          while ((exMatch = exampleRegex.exec(markdownContent)) !== null) {
            examples.push({ input: exMatch[1].trim(), output: exMatch[2].trim() });
          }

          return {
            statement: markdownContent,
            inputFormat: null,
            outputFormat: null,
            timeLimitMs,
            memoryLimitKb,
            examples,
            tutorialUrl: null,
          };
        }
      }
    } catch {}

    // Try Playwright as last resort
    try {
      const { renderPage } = await import('../renderer');
      html = await renderPage(pageUrl);
    } catch {
      return { statement: '', inputFormat: null, outputFormat: null, timeLimitMs: null, memoryLimitKb: null, examples: [], tutorialUrl: null };
    }
  }

  const $ = cheerio.load(html);

  const statementDiv = $('.problem-statement');
  if (!statementDiv.length) {
    return { statement: '', inputFormat: null, outputFormat: null, timeLimitMs: null, memoryLimitKb: null, examples: [], tutorialUrl: null };
  }

  // Time and Memory Limit
  const timeLimitStr = statementDiv.find('.time-limit').text();
  const timeLimitMs = timeLimitStr ? Math.round(parseFloat(timeLimitStr.match(/([\d.]+)/)?.[1] || '0') * 1000) : null;
  const memoryLimitStr = statementDiv.find('.memory-limit').text();
  const memoryLimitKb = memoryLimitStr ? parseInt(memoryLimitStr.match(/(\d+)/)?.[1] || '0', 10) * 1024 : null;

  // Convert section titles to h3 so turndown makes them ###
  statementDiv.find('.section-title').each((_, el) => {
    $(el).replaceWith(`<h3>${$(el).text()}</h3>`);
  });

  // Examples
  const examples: Array<{ input: string; output: string }> = [];
  statementDiv.find('.sample-test .input').each((i, el) => {
    const inputHtml = $(el).find('pre').html() || '';
    const outputEl = statementDiv.find('.sample-test .output').eq(i);
    const outputHtml = outputEl.find('pre').html() || '';

    // Replace <br> and </div> with \n to preserve line breaks before stripping HTML tags
    const cleanInput = inputHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim();
    const cleanOutput = outputHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim();

    examples.push({ input: cleanInput, output: cleanOutput });
  });

  // Extract sections and convert to Markdown
  const inputFormatHtml = statementDiv.find('.input-specification').html() || '';
  const outputFormatHtml = statementDiv.find('.output-specification').html() || '';
  const noteHtml = statementDiv.find('.note').html() || '';

  // Extract main problem statement (legend) explicitly
  let finalStatementHtml = statementDiv.find('.legend').html() || '';
  if (!finalStatementHtml) {
    finalStatementHtml = statementDiv.find('> div:nth-child(2)').html() || '';
  }

  let finalStatement = htmlToMarkdown(finalStatementHtml);
  if (noteHtml) {
    finalStatement += '\n\n' + htmlToMarkdown(noteHtml);
  }

  let tutorialUrl: string | null = null;
  $('.sidebar a').each((_, el) => {
    if ($(el).text().toLowerCase().includes('tutorial')) {
      const href = $(el).attr('href');
      if (href) {
        tutorialUrl = href.startsWith('http') ? href : `https://codeforces.com${href}`;
      }
    }
  });

  return {
    statement: finalStatement,
    inputFormat: inputFormatHtml ? htmlToMarkdown(inputFormatHtml) : null,
    outputFormat: outputFormatHtml ? htmlToMarkdown(outputFormatHtml) : null,
    timeLimitMs,
    memoryLimitKb,
    examples,
    tutorialUrl,
  };
}

// ── Difficulty mapping ────────────────────────────────────────────────────────

function cfRatingToDifficulty(rating?: number): string | null {
  if (!rating) return null;
  if (rating < 1000) return 'easy';
  if (rating < 1400) return 'easy-medium';
  if (rating < 1800) return 'medium';
  if (rating < 2200) return 'hard';
  return 'expert';
}

// ── Scraper ───────────────────────────────────────────────────────────────────

export class CodeforcesProblemScraper implements IProblemScraper {
  readonly platform = 'codeforces';

  canHandle(url: string): boolean {
    return /codeforces\.com\/(problemset\/problem|contest\/\d+\/problem|gym\/\d+\/problem)/i.test(url);
  }

  async scrapeProblem(url: string): Promise<ProblemScrapeResult> {
    const parsed = extractCFProblemId(url);
    if (!parsed) {
      return { problem: null, error: { type: 'ValidationError', message: `Could not extract contest/problem from URL: ${url}`, details: null } };
    }

    try {
      // Step 1: Fetch metadata via CF API.
      const apiUrl = `https://codeforces.com/api/problemset.problems?tags=`;
      const apiRes = await fetch(apiUrl);

      let cfProblem: CFProblemInfo | undefined;

      if (apiRes.ok) {
        const data = (await apiRes.json()) as CFApiProblemsResponse;
        if (data.status === 'OK' && data.result) {
          cfProblem = data.result.problems.find(
            (p) =>
              String(p.contestId) === parsed.contestId &&
              p.index === parsed.index
          );
        }
      }

      await sleep(2000);

      // Step 2: Scrape the full statement from the problem page.
      const pageData = await fetchCFProblemStatement(
        parsed.contestId,
        parsed.index
      );

      // Step 3: Fetch Editorial if tutorialUrl is present
      let editorialMarkdown: string | undefined = undefined;
      if (pageData.tutorialUrl) {
        editorialMarkdown = await fetchCFEditorialFromUrl(pageData.tutorialUrl);
      }

      // Fallback: If no tutorial link on problem page, search the contest page
      if (!editorialMarkdown) {
        editorialMarkdown = await fetchCFEditorialFromContest(parsed.contestId);
      }

      // Extract only the section for THIS problem from the full contest editorial.
      // CF tutorials cover all problems (A through F) — we only want the target.
      if (editorialMarkdown) {
        editorialMarkdown = extractProblemSection(editorialMarkdown, parsed.contestId, parsed.index);
      }

      // Step 4: Fetch Reference AC Submissions
      let referenceSolutions: { code: string; language: string; url: string }[] = [];
      try {
        const statusRes = await fetch(`https://codeforces.com/api/contest.status?contestId=${parsed.contestId}&from=1&count=50`);
        if (statusRes.ok) {
          const statusData = (await statusRes.json()) as any;
          if (statusData.status === 'OK' && statusData.result) {
            const acSubs = statusData.result
              .filter((s: any) => s.verdict === 'OK' && s.problem.index === parsed.index && s.programmingLanguage.includes('C++'))
              .slice(0, 2);

            for (const sub of acSubs) {
              await sleep(1000); // Rate limit protection
              const subUrl = `https://codeforces.com/contest/${parsed.contestId}/submission/${sub.id}`;
              const subPageRes = await fetch(subUrl);
              if (subPageRes.ok) {
                const subHtml = await subPageRes.text();
                const $sub = cheerio.load(subHtml);
                const code = $sub('#program-source-text').text();
                if (code) {
                  referenceSolutions.push({
                    code,
                    language: sub.programmingLanguage,
                    url: subUrl,
                  });
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn('Failed to fetch AC submissions', e);
      }

      const problem: ScrapedProblem = {
        id: `${parsed.contestId}${parsed.index}`,
        url,
        platform: 'codeforces',
        title: cfProblem?.name ?? `Problem ${parsed.contestId}${parsed.index}`,
        isInteractive: cfProblem?.tags?.includes('interactive') ?? false,
        content: {
          problemStatementMarkdown: pageData.statement + (pageData.inputFormat ? `\n\n${pageData.inputFormat}` : '') + (pageData.outputFormat ? `\n\n${pageData.outputFormat}` : ''),
          constraintsMarkdown: `- **Time Limit:** ${pageData.timeLimitMs ? pageData.timeLimitMs / 1000 + ' seconds' : 'Unknown'}\n- **Memory Limit:** ${pageData.memoryLimitKb ? pageData.memoryLimitKb / 1024 + ' MB' : 'Unknown'}`,
          editorialMarkdown: editorialMarkdown,
        },
        examples: pageData.examples.map((ex: any, i: number) => ({
          testId: i + 1,
          input: ex.input,
          output: ex.output,
        })),
        referenceSolutions: referenceSolutions.length > 0 ? referenceSolutions : undefined,
      };

      return { problem, error: null };
    } catch (err: any) {
      return {
        problem: null,
        error: { type: 'ScrapeError', message: err.message || String(err), details: err } as any,
      };
    }
  }
}

// ── Editorial fetching helpers ────────────────────────────────────────────────

/**
 * Extract only the section for a specific problem from a full CF contest editorial.
 * CF tutorials cover all problems (A through F) with headers like:
 *   ## [1491D - Zookeeper and The Infinite Zoo](...)
 *   1491D - Zookeeper and The Infinite Zoo
 *   ## 1491E - Product of Closures
 * We match with or without ## prefix.
 */
function extractProblemSection(editorial: string, contestId: string, index: string): string {
  const problemKey = `${contestId}${index.toUpperCase()}`;

  // Match problem section headers with or without ## prefix.
  // Matches at start of string OR after a newline.
  // Examples: "## [1491D - ..." or "## 1491D - ..." or "1491D - ..." or "[2025A - ..."
  const headerPattern = /(?:^|\n)#{0,3}\s*\[?(\d{1,5}[A-Z])\s*[-\]\.]/gi;
  const matches: Array<{ key: string; start: number }> = [];
  let m;
  while ((m = headerPattern.exec(editorial)) !== null) {
    matches.push({ key: m[1].toUpperCase(), start: m.index });
  }

  if (matches.length === 0) return editorial;

  const ourMatch = matches.find((mt) => mt.key === problemKey);
  if (!ourMatch) return editorial;

  const matchIdx = matches.indexOf(ourMatch);
  const endIdx = matchIdx + 1 < matches.length ? matches[matchIdx + 1].start : editorial.length;

  return editorial.substring(ourMatch.start, endIdx).trim();
}

/**
 * Fetch a CF editorial from a blog entry URL.
 * Tries the Codeforces API first, then falls back to scraping the blog page HTML
 * (the API sometimes returns empty content).
 */
async function fetchCFEditorialFromUrl(tutorialUrl: string): Promise<string | undefined> {
  try {
    const match = tutorialUrl.match(/blog\/entry\/(\d+)/);
    if (!match) return undefined;

    const blogEntryId = match[1];

    // Strategy 1: Codeforces API
    const edRes = await fetch(`https://codeforces.com/api/blogEntry.view?blogEntryId=${blogEntryId}`);
    if (edRes.ok) {
      const edData = (await edRes.json()) as any;
      if (edData.status === 'OK' && edData.result?.blogEntry?.content) {
        return htmlToMarkdown(edData.result.blogEntry.content);
      }
    }

    // Strategy 2: Fetch the blog page HTML directly and extract content
    const pageRes = await fetch(`https://codeforces.com/blog/entry/${blogEntryId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (pageRes.ok) {
      const pageHtml = await pageRes.text();
      const $page = cheerio.load(pageHtml);
      // The editorial content is in .ttypography within the blog entry
      const $typo = $page('.ttypography');
      if (!$typo.length) return undefined;

      // Escape < and > inside <pre> and <code> tags so they aren't stripped
      // as HTML tags (e.g. #include <bits/stdc++.h> → #include <bits/stdc++.h>)
      $typo.find('pre, code').each((_, el) => {
        const $el = $page(el);
        const html = $el.html() || '';
        $el.html(html.replace(/</g, '<').replace(/>/g, '>'));
      });

      const content = $typo.html() || '';
      if (content.trim().length > 100) {
        return htmlToMarkdown(content);
      }
    }
  } catch (e) {
    console.warn('Failed to fetch CF editorial', e);
  }
  return undefined;
}

/**
 * Search the contest page for Tutorial/Editorial/Announcement links and fetch
 * the editorial content. This is a fallback for problems that don't have a
 * direct "Tutorial" link on their problem page.
 */
async function fetchCFEditorialFromContest(contestId: string): Promise<string | undefined> {
  try {
    // Fetch the contest page which lists materials (announcements, tutorials)
    const contestUrl = `https://codeforces.com/contest/${contestId}`;
    const res = await fetch(contestUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) return undefined;

    const html = await res.text();
    const $ = cheerio.load(html);

    // Look for links containing "Tutorial", "Editorial", or "Announcement"
    const editorialLinks: string[] = [];
    $('a').each((_, el) => {
      const text = $(el).text().toLowerCase().trim();
      const href = $(el).attr('href');
      if (!href) return;

      // Prioritize "Tutorial" > "Editorial" > "Announcement"
      if (text.includes('tutorial') || text.includes('editorial')) {
        const fullUrl = href.startsWith('http') ? href : `https://codeforces.com${href}`;
        // Extract the blog entry ID
        if (fullUrl.includes('/blog/entry/')) {
          editorialLinks.push(fullUrl);
        }
      }
    });

    // Also check the "Materials" section specifically
    $('.links ul li a, .contest-links a').each((_, el) => {
      const text = $(el).text().toLowerCase().trim();
      const href = $(el).attr('href');
      if (!href) return;
      if (text.includes('tutorial') || text.includes('editorial') || text.includes('announcement')) {
        const fullUrl = href.startsWith('http') ? href : `https://codeforces.com${href}`;
        if (fullUrl.includes('/blog/entry/') && !editorialLinks.includes(fullUrl)) {
          editorialLinks.push(fullUrl);
        }
      }
    });

    // Try each link until we find editorial content
    for (const link of editorialLinks) {
      const editorial = await fetchCFEditorialFromUrl(link);
      if (editorial) return editorial;
    }

    return undefined;
  } catch (e) {
    console.warn('Failed to fetch CF editorial from contest page', e);
    return undefined;
  }
}
