import TurndownService from 'turndown';

/**
 * Creates a configured TurndownService for Hybrid Markdown (Markdown + Safe HTML).
 * Keeps complex HTML tags like tables, images, gifs, iframe, details, kbd intact
 * while converting standard prose, headings, and lists to Markdown.
 */
export function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });

  // Preserve LaTeX formulas & math backslashes without escaping
  service.escape = (string) => string;

  // Preserve complex HTML elements out-of-the-box (images, GIFs, tables, diagrams, interactive details)
  service.keep([
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'img',
    'iframe',
    'details',
    'summary',
    'kbd',
    'picture',
    'video',
    'figure',
    'figcaption',
    'sub',
    'sup',
  ] as unknown as (keyof HTMLElementTagNameMap)[]);

  // Also preserve SVG and math blocks
  service.addRule('preserve-svg', {
    filter: (node) => node.nodeName.toLowerCase() === 'svg' || node.nodeName.toLowerCase() === 'math',
    replacement: (_content, node) => (node as HTMLElement).outerHTML || '',
  });

  return service;
}

const defaultTurndownService = createTurndownService();

/**
 * Converts raw problem HTML into clean Hybrid Markdown preserving LaTeX math, images, GIFs, and tables.
 */
export function htmlToHybridMarkdown(html: string): string {
  if (!html) return '';

  let markdown = defaultTurndownService.turndown(html);

  // Normalize Codeforces $$$ math delimiters to standard $$ for remark-math / KaTeX
  markdown = markdown.replace(/\$\$\$/g, '$$');

  // Unescape any escaped dollar signs
  markdown = markdown.replace(/\\(\$)/g, '$1');

  return markdown.trim();
}
