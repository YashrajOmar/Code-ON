/**
 * Deterministic post-processing for LLM-extracted problem data.
 *
 * The Gemini extraction is unreliable — it leaves HTML entities undecoded,
 * duplicates examples (in both the statement and the examples array),
 * collapses newlines in example fields, and drops inline highlighting
 * (<strong>/<mark>/<u> tags that indicate which substring is being referred to).
 *
 * This module provides pure, deterministic functions that clean up whatever
 * the LLM produces, so formatting is ALWAYS correct regardless of LLM variance.
 * This is the permanent safety net — no more "every time I work on the web
 * there's a formatting issue."
 */

import type { ScrapedProblem } from './types';

// ── 1. HTML Entity Decoding ───────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
  laquo: '\u00AB',
  raquo: '\u00BB',
  deg: '\u00B0',
  times: '\u00D7',
  minus: '\u2212',
  le: '\u2264',
  ge: '\u2265',
  ne: '\u2260',
  infin: '\u221E',
  sum: '\u2211',
  prod: '\u220F',
  alpha: '\u03B1',
  beta: '\u03B2',
  gamma: '\u03B3',
  delta: '\u03B4',
  epsilon: '\u03B5',
  theta: '\u03B8',
  lambda: '\u03BB',
  mu: '\u03BC',
  pi: '\u03C0',
  sigma: '\u03C3',
  phi: '\u03C6',
  omega: '\u03C9',
  Sigma: '\u03A3',
  Pi: '\u03A0',
  Omega: '\u03A9',
  part: '\u2202',
  nabla: '\u2207',
  forall: '\u2200',
  exist: '\u2203',
  rarr: '\u2192',
  larr: '\u2190',
  harr: '\u2194',
  uarr: '\u2191',
  darr: '\u2193',
  lrarr: '\u21C6',
  lfloor: '\u230A',
  rfloor: '\u230B',
  lceil: '\u2308',
  rceil: '\u2309',
  radic: '\u221A',
  prop: '\u221D',
  equiv: '\u2261',
  sim: '\u223C',
  approx: '\u2248',
  sub: '\u2282',
  sup: '\u2283',
  nsub: '\u2284',
  sube: '\u2286',
  supe: '\u2287',
  cup: '\u222A',
  cap: '\u2229',
  empty: '\u2205',
  in: '\u2208',
  notin: '\u2209',
  vdots: '\u22EE',
  cdots: '\u22EF',
  ldots: '\u2026',
  permil: '\u2030',
  prime: '\u2032',
  Prime: '\u2033',
  frac12: '\u00BD',
  frac14: '\u00BC',
  frac34: '\u00BE',
  sup2: '\u00B2',
  sup3: '\u00B3',
  plusmn: '\u00B1',
  middot: '\u00B7',
  bull: '\u2022',
  dagger: '\u2020',
  Daquot: '\u2021',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
  euro: '\u20AC',
  pound: '\u00A3',
  cent: '\u00A2',
  yen: '\u00A5',
  sect: '\u00A7',
  para: '\u00B6',
  check: '\u2713',
  cross: '\u2717',
  arrow: '\u2192',
};

/**
 * Decode all HTML entities (named + numeric) in a string.
 * Handles `<`, `>`, `&`, `"`, `&#39;`, `&#x27;`, etc.
 *
 * Handles DOUBLE-ENCODED entities by running up to 3 passes:
 *   " → " → "  (LeetCode does this in test cases)
 *
 * Does NOT touch LaTeX math delimiters ($, $$) or code blocks (`` ` ``).
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return text;

  // Run up to 3 passes to fully resolve double/triple-encoded entities.
  let result = text;
  for (let pass = 0; pass < 3; pass++) {
    const decoded = result.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
      // Numeric: &#123; or &#x7B;
      if (entity.startsWith('#')) {
        const isHex = entity[1] === 'x' || entity[1] === 'X';
        const num = isHex ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        if (isNaN(num)) return match;
        return String.fromCodePoint(num);
      }

      // Named
      const decoded = NAMED_ENTITIES[entity];
      return decoded ?? match;
    });
    // Stop early if no more entities to decode (avoid infinite loop).
    if (decoded === result) break;
    result = decoded;
  }
  return result;
}

// ── 2. Strip Examples from Statement ──────────────────────────────────────────

/**
 * Remove example sections from the problem statement markdown.
 *
 * The Gemini LLM often includes the full examples (Input/Output/Explanation)
 * inside `problemStatementMarkdown` AND in the `examples` array, causing
 * duplicate rendering. Since the frontend renders examples from the array,
 * we strip any trailing "Example N:" blocks from the statement.
 *
 * Detects common patterns:
 *   - "Example 1:" / "Example 1：" / "**Example 1:**"
 *   - "Examples:" / "**Examples:**"
 *   - "Sample Input/Output"
 */
export function stripExamplesFromStatement(statement: string): string {
  if (!statement) return statement;

  // Match from the first "Example" heading to the end — examples are always
  // at the end of the statement, before constraints.
  const patterns = [
    /\n\s*\**\s*Example\s*1\s*[:\：\.]?\s*\**.*$/is, // Example 1: ... (multiline to end)
    /\n\s*\**\s*Examples?\s*[:\：]?\s*\**.*$/is,      // Examples: ... (multiline to end)
    /\n\s*\**\s*Sample\s+(?:Input|Example).*$/is,      // Sample Input/Output ...
  ];

  for (const pattern of patterns) {
    const cleaned = statement.replace(pattern, '').trim();
    if (cleaned.length < statement.length) {
      return cleaned;
    }
  }

  return statement.trim();
}

// ── 3. Normalize Example Fields ────────────────────────────────────────────────

/**
 * Normalize an example input/output field:
 *   - Decode HTML entities
 *   - Preserve meaningful newlines (Input: / Output: labels on separate lines)
 *   - Collapse runs of 3+ blank lines to 2
 *   - Strip leading/trailing whitespace
 */
export function normalizeExampleField(field: string | undefined): string {
  if (!field) return '';
  let result = field;
  // Collapse 3+ newlines to 2
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

/**
 * Normalize an example explanation:
 *   - Preserve markdown formatting (bold, lists, etc.)
 *   - Collapse excessive blank lines
 *
 * NOTE: HTML entity decoding is the final step in postProcessScrapedProblem.
 */
export function normalizeExplanation(field: string | undefined): string | undefined {
  if (!field) return undefined;
  let result = field;
  result = result.replace(/\n{3,}/g, '\n\n');
  const trimmed = result.trim();
  return trimmed || undefined;
}

// ── 4. Normalize Markdown Text ────────────────────────────────────────────────

/**
 * Clean up markdown text fields (statement, constraints, editorial):
 *   - Replace <iframe> tags with a Markdown link to their src (preserve code refs)
 *   - Ensure Markdown headers start on their own line
 *   - Collapse excessive blank lines (3+ → 2)
 *   - Normalize line endings
 *   - Strip trailing whitespace on each line
 *
 * NOTE: HTML entity decoding is deliberately NOT done here. It must run as the
 * absolute final step (see postProcessScrapedProblem) so that the literal `<`
 * and `>` characters produced by decoding are not re-escaped by any downstream
 * string manipulation or by the Markdown renderer's XSS protection.
 */
export function normalizeMarkdown(text: string | undefined): string {
  if (!text) return text ?? '';
  let result = text;
  // Normalize line endings
  result = result.replace(/\r\n?/g, '\n');
  // Replace <iframe src="...">...</iframe> with a link that opens in a new tab.
  // LeetCode playgrounds contain the actual implementation code — never delete.
  // Using raw HTML <a> so we can set target="_blank" + rel="noopener" (DOMPurify
  // already allows these attrs in the frontend).
  result = result.replace(/<iframe[^>]*\bsrc=["']([^"']+)["'][^>]*>([\s\S]*?)<\/iframe>/gi,
    (_m, src: string) => `\n<a href="${src}" target="_blank" rel="noopener noreferrer">View Implementation Code</a>\n`);
  // Replace self-closing <iframe src="..."/>
  result = result.replace(/<iframe[^>]*\bsrc=["']([^"']+)["'][^>]*\/>/gi,
    (_m, src: string) => `\n<a href="${src}" target="_blank" rel="noopener noreferrer">View Implementation Code</a>\n`);
  // Replace orphan <iframe src="..."> (no closing tag)
  result = result.replace(/<iframe[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
    (_m, src: string) => `\n<a href="${src}" target="_blank" rel="noopener noreferrer">View Implementation Code</a>\n`);
  // Strip Codeforces "Tutorial is loading..." placeholder text
  result = result.replace(/Tutorial is loading\.\.\./gi, '');
  // Ensure Markdown headers (#{1,6}) start on their own line
  result = result.replace(/(?<!\n)(\s*)(#{1,6}\s)/g, '\n\n$2');
  // Strip trailing whitespace per line
  result = result.replace(/[ \t]+$/gm, '');
  // Collapse 3+ blank lines to 2
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

// ── 5. Post-Process Full Extraction ───────────────────────────────────────────

/**
 * The shape of data returned by Gemini extraction (before ScrapedProblem mapping).
 */
interface ExtractionData {
  title: string;
  isInteractive: boolean;
  problemStatementMarkdown: string;
  constraintsMarkdown?: string;
  editorialMarkdown?: string;
  examples: Array<{
    testId: number;
    input: string;
    output: string;
    explanation?: string;
  }>;
}

/**
 * Apply ALL post-processing fixes to Gemini extraction output.
 * This is the single entry point called by sanitizer.ts.
 *
 * NOTE: The Gemini path's output is ALSO run through postProcessScrapedProblem
 * by the registry, so this function focuses on Gemini-specific shaping
 * (separating examples/constraints from the statement). Entity decoding runs
 * as the final step here too, to keep behavior identical if this function is
 * ever used standalone.
 */
export function postProcessExtraction(data: ExtractionData): ExtractionData {
  // ── Shape pass (no entity decoding yet) ──────────────────────────────────
  let statement = normalizeMarkdown(data.problemStatementMarkdown);
  // Strip examples from statement (they're rendered from the examples array)
  statement = stripExamplesFromStatement(statement);
  // Strip duplicate constraints from statement if they exist separately
  if (data.constraintsMarkdown) {
    statement = stripConstraintsFromStatement(statement);
  }

  const constraintsMarkdown = data.constraintsMarkdown
    ? normalizeMarkdown(data.constraintsMarkdown)
    : undefined;

  const editorialMarkdown = data.editorialMarkdown
    ? normalizeMarkdown(data.editorialMarkdown)
    : undefined;

  const examples = data.examples.map((ex) => ({
    testId: ex.testId,
    input: normalizeExampleField(ex.input),
    output: normalizeExampleField(ex.output),
    explanation: normalizeExplanation(ex.explanation),
  }));

  // ── Final pass: decode HTML entities + normalize comparison operators ─────
  return {
    title: decodeHtmlEntities(data.title).trim(),
    isInteractive: data.isInteractive,
    problemStatementMarkdown: normalizeComparisonOperators(decodeHtmlEntities(statement)),
    constraintsMarkdown: constraintsMarkdown ? normalizeComparisonOperators(decodeHtmlEntities(constraintsMarkdown)) : undefined,
    editorialMarkdown: editorialMarkdown ? normalizeComparisonOperators(decodeHtmlEntities(editorialMarkdown)) : undefined,
    examples: examples.map((ex) => ({
      ...ex,
      input: normalizeComparisonOperators(decodeHtmlEntities(ex.input)),
      output: normalizeComparisonOperators(decodeHtmlEntities(ex.output)),
      explanation: ex.explanation ? normalizeComparisonOperators(decodeHtmlEntities(ex.explanation)) : undefined,
    })),
  };
}

/**
 * Strip a trailing constraints section from the statement if constraints
 * are stored separately in constraintsMarkdown.
 * Detects "Constraints:" / "**Constraints:**" / "Constraints" headings.
 */
function stripConstraintsFromStatement(statement: string): string {
  if (!statement) return statement;

  const patterns = [
    /\n\s*\**\s*Constraints\s*[:\：]?\s*\**.*$/is,
  ];

  for (const pattern of patterns) {
    const cleaned = statement.replace(pattern, '').trim();
    if (cleaned.length < statement.length) {
      return cleaned;
    }
  }

  return statement.trim();
}

// ── 7. Normalize Comparison Operators ────────────────────────────────────────

/**
 * Replace ASCII comparison operators with Unicode equivalents to avoid
 * the DOMPurify → react-markdown double-escape chain:
 *   < → < → DOMPurify re-escapes to < → react-markdown escapes & → &lt; → shows "<"
 *
 * Unicode ≤ ≥ ≠ are semantic equivalents that never trigger HTML escaping.
 */
function normalizeComparisonOperators(text: string): string {
  // Split on fenced code blocks (```...```) and only replace in non-code sections.
  // Replacing <= with ≤ inside code blocks corrupts C++ source code.
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) => {
      // Even indices are non-code, odd indices are code blocks
      if (i % 2 === 0) {
        return part
          .replace(/<=/g, '\u2264')   // ≤
          .replace(/>=/g, '\u2265')   // ≥
          .replace(/!=(?!=)/g, '\u2260'); // ≠ (but not !==)
      }
      return part;
    })
    .join('');
}

// ── 6. Post-Process ScrapedProblem (all scraper paths) ───────────────────────

/**
 * Apply deterministic post-processing directly to a ScrapedProblem.
 *
 * This is the UNIVERSAL entry point called by the ScraperRegistry for ALL
 * scraper paths — LeetCode (GraphQL + Turndown), Codeforces (Cheerio +
 * Turndown), and Generic (Gemini AI). It guarantees consistent formatting
 * regardless of which scraper produced the data.
 *
 * Fixes applied (in strict order):
 *   1. Replace <iframe> tags with Markdown links to their src (preserve code refs)
 *   2. Ensure Markdown headers start on their own line
 *   3. Normalize whitespace in example input/output/explanation
 *   4. Strip examples from statement if they're in the examples array
 *   5. DECODE HTML ENTITIES — absolute final step. This MUST run last so the
 *      literal `<`/`>` it produces are not re-escaped by any downstream string
 *      manipulation or by the Markdown renderer's XSS protection.
 */
export function postProcessScrapedProblem(problem: ScrapedProblem): ScrapedProblem {
  // ── Shape pass (no entity decoding yet) ──────────────────────────────────
  const shapedStatement = stripExamplesFromStatement(
    normalizeMarkdown(problem.content.problemStatementMarkdown)
  );
  const shapedConstraints = problem.content.constraintsMarkdown
    ? normalizeMarkdown(problem.content.constraintsMarkdown)
    : undefined;
  const shapedEditorial = problem.content.editorialMarkdown
    ? normalizeMarkdown(problem.content.editorialMarkdown)
    : undefined;
  const shapedExamples = problem.examples.map((ex) => ({
    ...ex,
    input: normalizeExampleField(ex.input),
    output: normalizeExampleField(ex.output),
    explanation: normalizeExplanation(ex.explanation),
  }));

  // ── Final pass: decode HTML entities on every raw string ──────────────────
  // This is the LAST operation so nothing re-escapes the decoded `<`/`>`.
  // Then replace <= >= with Unicode ≤ ≥ to avoid DOMPurify/react-markdown
  // double-escaping the < character back to <.
  return {
    ...problem,
    title: decodeHtmlEntities(problem.title).trim(),
    content: {
      problemStatementMarkdown: normalizeComparisonOperators(decodeHtmlEntities(shapedStatement)),
      constraintsMarkdown: shapedConstraints
        ? normalizeComparisonOperators(decodeHtmlEntities(shapedConstraints))
        : undefined,
      editorialMarkdown: shapedEditorial
        ? normalizeComparisonOperators(decodeHtmlEntities(shapedEditorial))
        : undefined,
    },
    examples: shapedExamples.map((ex) => ({
      ...ex,
      input: normalizeComparisonOperators(decodeHtmlEntities(ex.input)),
      output: normalizeComparisonOperators(decodeHtmlEntities(ex.output)),
      explanation: ex.explanation ? normalizeComparisonOperators(decodeHtmlEntities(ex.explanation)) : undefined,
    })),
  };
}
