import { ScrapedProblem, ScrapedProblemSchema } from './types';

export interface CompanionTest {
  input: string;
  output: string;
  id?: number;
}

export interface CompanionPayload {
  name: string;
  group?: string;
  url: string;
  interactive?: boolean;
  memoryLimit?: number; // In MB
  timeLimit?: number; // In ms
  tests?: CompanionTest[];
  testType?: string;
  input?: { type: string; fileName?: string };
  output?: { type: string; fileName?: string };
  languages?: { java?: { mainClass?: string; taskClass?: string } };
  batch?: { id: string; size: number };
}

export function detectPlatformFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('codeforces')) return 'codeforces';
    if (host.includes('leetcode')) return 'leetcode';
    if (host.includes('atcoder')) return 'atcoder';
    if (host.includes('codechef')) return 'codechef';
    if (host.includes('cses')) return 'cses';
    if (host.includes('kattis')) return 'kattis';
    if (host.includes('hackerrank')) return 'hackerrank';
    if (host.includes('spoj')) return 'spoj';
    if (host.includes('topcoder')) return 'topcoder';
    if (host.includes('usaco')) return 'usaco';
    if (host.includes('toph')) return 'toph';
    if (host.includes('luogu')) return 'luogu';
    return host.replace(/^www\./, '').split('.')[0] || 'competitive-programming';
  } catch {
    return 'competitive-programming';
  }
}

export function parseCompanionPayload(payload: CompanionPayload): ScrapedProblem {
  if (!payload || !payload.url || !payload.name) {
    throw new Error('Invalid Competitive Companion payload: name and url are required');
  }

  const platform = detectPlatformFromUrl(payload.url);
  
  // Format clean unique problem ID
  const sanitizedTitle = payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const problemId = `${platform}-${sanitizedTitle || Date.now().toString()}`;

  // Time & memory limits formatting
  const timeLimitStr = payload.timeLimit ? `${(payload.timeLimit / 1000).toFixed(1)}s (${payload.timeLimit} ms)` : '1.0s (1000 ms)';
  const memoryLimitStr = payload.memoryLimit ? `${payload.memoryLimit} MB` : '256 MB';

  // Construct Markdown Problem Statement
  const statementMarkdown = [
    `# ${payload.name}`,
    '',
    `* **Platform:** ${platform.toUpperCase()}`,
    payload.group ? `* **Contest / Group:** ${payload.group}` : null,
    `* **Time Limit:** ${timeLimitStr}`,
    `* **Memory Limit:** ${memoryLimitStr}`,
    '',
    `> **⚡ Instant Import:** Problem statement and testcases ingested directly from Competitive Companion browser extension.`,
    '',
    `* **Original Problem Link:** [${payload.url}](${payload.url})`,
  ].filter(Boolean).join('\n');

  const constraintsMarkdown = `- Time Limit: ${timeLimitStr}\n- Memory Limit: ${memoryLimitStr}`;

  const tests = Array.isArray(payload.tests) ? payload.tests : [];
  const examples = tests.map((t, idx) => ({
    testId: idx + 1,
    input: typeof t.input === 'string' ? t.input : '',
    output: typeof t.output === 'string' ? t.output : '',
  }));

  const rawProblem: ScrapedProblem = {
    id: problemId,
    title: payload.name,
    url: payload.url,
    platform,
    isInteractive: Boolean(payload.interactive),
    content: {
      problemStatementMarkdown: statementMarkdown,
      constraintsMarkdown,
      editorialMarkdown: undefined,
    },
    examples,
  };

  return ScrapedProblemSchema.parse(rawProblem);
}
