import { NextResponse } from 'next/server';
import { executeCode } from '@/lib/fast-exec';
import { getAuthUser, unauthorized } from '@/lib/auth';
import { rateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit';

function compareCPOutput(actual: string, expected: string): boolean {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const tokenize = (str: string) => str.trim().split(/\s+/).filter(Boolean);

  const actualTokens = tokenize(actual);
  const expectedTokens = tokenize(expected);

  if (actualTokens.length !== expectedTokens.length) return false;

  for (let i = 0; i < expectedTokens.length; i++) {
    if (actualTokens[i] !== expectedTokens[i]) return false;
  }
  return true;
}

export async function POST(req: Request) {
  try {
    const authUser = await getAuthUser();
    if (!authUser) return unauthorized();

    const rl = rateLimit(`execute:${authUser.userId}`, RATE_LIMITS.execute);
    if (!rl.allowed) return tooManyRequests(rl.resetAt);

    const { code, language, testCases } = await req.json();

    if (!code?.trim()) {
      return NextResponse.json({ verdict: 'CE', message: 'No code provided.', results: [] });
    }

    if (!Array.isArray(testCases) || testCases.length === 0) {
      return NextResponse.json({ verdict: 'CE', message: 'No test cases provided.', results: [] });
    }

    // Fast-path: execute all test cases directly on warm Docker containers.
    // No BullMQ, no Redis — direct `docker exec` on pre-warmed containers.
    // Typical latency: ~400ms per test case.
    const results = await Promise.all(
      testCases.map(async (tc: any) => {
        const { output, error } = await executeCode(code, tc.input || '');

        if (error === 'compilation') {
          return { actual: output, pass: false, isCompileError: true };
        }
        if (error === 'timeout') {
          return { actual: 'Time Limit Exceeded', pass: false, isTimeout: true };
        }

        const pass = compareCPOutput(output, tc.expected);
        return { actual: output, pass };
      })
    );

    let allPass = true;
    let anyCompileError = false;
    let anyRuntimeError = false;

    for (const r of results) {
      if ((r as any).isCompileError) anyCompileError = true;
      if ((r as any).isTimeout) anyRuntimeError = true;
      if (!r.pass) allPass = false;
    }

    let verdict = 'WA';
    if (anyCompileError) verdict = 'CE';
    else if (anyRuntimeError) verdict = 'TLE';
    else if (allPass && results.length > 0) verdict = 'AC';

    return NextResponse.json({ verdict, results });
  } catch (error: any) {
    console.error('Execution error:', error);
    return NextResponse.json({
      verdict: 'CE',
      message: error?.message || 'Evaluation failed',
      results: [],
    });
  }
}
