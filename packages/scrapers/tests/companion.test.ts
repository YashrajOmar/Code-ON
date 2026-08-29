import { describe, it, expect } from 'vitest';
import {
  parseCompanionPayload,
  detectPlatformFromUrl,
  startCompanionListener,
  CompanionPayload,
} from '../src';
import http from 'http';

describe('Competitive Companion Ingestion', () => {
  it('correctly detects platforms from problem URLs', () => {
    expect(detectPlatformFromUrl('https://codeforces.com/problemset/problem/4/A')).toBe('codeforces');
    expect(detectPlatformFromUrl('https://leetcode.com/problems/two-sum/')).toBe('leetcode');
    expect(detectPlatformFromUrl('https://atcoder.jp/contests/abc300/tasks/abc300_a')).toBe('atcoder');
    expect(detectPlatformFromUrl('https://cses.fi/problemset/task/1068')).toBe('cses');
    expect(detectPlatformFromUrl('https://www.codechef.com/problems/FLOW001')).toBe('codechef');
    expect(detectPlatformFromUrl('https://open.kattis.com/problems/hello')).toBe('kattis');
  });

  it('transforms Competitive Companion Codeforces payload into ScrapedProblemDTO', () => {
    const mockPayload: CompanionPayload = {
      name: 'A. Watermelon',
      group: 'Codeforces - Codeforces Beta Round 4 (Div. 2 Only)',
      url: 'https://codeforces.com/problemset/problem/4/A',
      interactive: false,
      memoryLimit: 256,
      timeLimit: 1000,
      tests: [
        {
          input: '8\n',
          output: 'YES\n',
        },
      ],
      testType: 'single',
      input: { type: 'stdin' },
      output: { type: 'stdout' },
      languages: {
        java: {
          mainClass: 'Main',
          taskClass: 'AWatermelon',
        },
      },
    };

    const problem = parseCompanionPayload(mockPayload);

    expect(problem.id).toBe('codeforces-a-watermelon');
    expect(problem.title).toBe('A. Watermelon');
    expect(problem.url).toBe('https://codeforces.com/problemset/problem/4/A');
    expect(problem.platform).toBe('codeforces');
    expect(problem.isInteractive).toBe(false);

    // Markdown statement verification
    expect(problem.content.problemStatementMarkdown).toContain('# A. Watermelon');
    expect(problem.content.problemStatementMarkdown).toContain('Codeforces Beta Round 4');
    expect(problem.content.problemStatementMarkdown).toContain('1.0s (1000 ms)');
    expect(problem.content.problemStatementMarkdown).toContain('256 MB');

    // Test cases verification
    expect(problem.examples).toHaveLength(1);
    expect(problem.examples[0].testId).toBe(1);
    expect(problem.examples[0].input).toBe('8\n');
    expect(problem.examples[0].output).toBe('YES\n');
  });

  it('handles multiple test cases and custom platform URLs gracefully', () => {
    const mockPayload: CompanionPayload = {
      name: 'Weird Algorithm',
      group: 'CSES - CSES Problem Set',
      url: 'https://cses.fi/problemset/task/1068',
      interactive: false,
      memoryLimit: 512,
      timeLimit: 1000,
      tests: [
        { input: '3\n', output: '3 10 5 16 8 4 2 1\n' },
        { input: '1\n', output: '1\n' },
      ],
    };

    const problem = parseCompanionPayload(mockPayload);

    expect(problem.platform).toBe('cses');
    expect(problem.examples).toHaveLength(2);
    expect(problem.examples[0].input).toBe('3\n');
    expect(problem.examples[1].output).toBe('1\n');
  });

  it('starts companion listener on an available test port and receives payload', async () => {
    const testPort = 19988;
    let receivedProblemTitle = '';

    const listener = startCompanionListener({
      ports: [testPort],
      onProblemReceived: (problem) => {
        receivedProblemTitle = problem.title;
      },
    });

    // Wait 100ms for listener to bind
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Send mock POST payload to testPort
    const mockPayload = {
      name: '10043 Test Problem',
      url: 'https://codeforces.com/problemset/problem/1/A',
      tests: [{ input: '6 6 4', output: '4' }],
    };

    const postData = JSON.stringify(mockPayload);

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          resolve();
        }
      );

      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    expect(receivedProblemTitle).toBe('10043 Test Problem');

    listener.stop();
  });
});
