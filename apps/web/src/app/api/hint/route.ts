import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CodeAnalysisEngine } from '@codeon/code-analysis';
import { retrieveUserProfileContext } from '@/lib/rag';
import { getActiveProvider, streamCompletion } from '@/lib/ai-providers';
import { getAuthUser, unauthorized } from '@/lib/auth';
import { rateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit';

/**
 * Main AI Mentor API — /api/hint
 *
 * Pipeline (strict order):
 *   1. Resolve an AI provider API key (client-supplied or stored in DB).
 *   2. Run the user's code through the Tree-sitter CodeAnalysisEngine to
 *      derive structural complexity (O(1) vs O(n) vs O(n²) …) and detected
 *      techniques.
 *   3. Fetch the user's RAG Coding Style Profile (lib/rag.ts) — cosine search
 *      over their historical UserTopicProfile embeddings.
 *   4. Fetch the AUTHORITATIVE editorial + reference solutions directly from
 *      the database by problem URL. Frontend-supplied editorial is NEVER
 *      trusted for grounding.
 *   5. Assemble a master Socratic system prompt injecting the AST approach,
 *      the RAG skill tier, and the editorial, then stream the hint.
 */



// ── AST structural analysis ───────────────────────────────────────────────────

interface StructuralAssessment {
  complexity: string;
  approach: string;
  detectedTechniques: string;
  qualityWarnings: string;
  raw: string;
}

/**
 * Translate a CodeAnalysisReport into a compact structural assessment.
 *
 * NOTE: the engine emits Big-O using Unicode superscripts (e.g. `O(n²)`,
 * `O(n³)`), so naive `includes('O(N^2)')` checks never match. We classify
 * from the CFG nesting depth + recursion flag instead, which is robust.
 */
function assessStructure(report: {
  complexity: { timeComplexity: string; spaceComplexity: string; nestingDepth: number; hasRecursion: boolean; confidence: string; explanation: string };
  optimization: { detectedStructures: string[]; hasHashMap: boolean; hasTwoPointers: boolean; hasBinarySearch: boolean; hasDPTable: boolean; hasSlidingWindow: boolean; hasSortingCall: boolean };
  syntax: { errors: Array<{ message: string }> };
}): StructuralAssessment {
  const { complexity, optimization, syntax } = report;

  let approach: string;
  if (complexity.hasRecursion) {
    approach = 'recursive (complexity depends on the recurrence relation)';
  } else {
    switch (complexity.nestingDepth) {
      case 0:
        approach = 'O(1) — constant / direct formula (no loops)';
        break;
      case 1:
        approach = optimization.hasSortingCall
          ? 'O(n log n) — sorting-based linear pass'
          : 'O(n) — single linear pass';
        break;
      case 2:
        approach = 'O(n²) — brute force (nested loops)';
        break;
      case 3:
        approach = 'O(n³) — brute force (triple nested loops)';
        break;
      default:
        approach = `O(n^${complexity.nestingDepth}) — deeply nested brute force`;
        break;
    }
  }

  const techniques: string[] = [];
  if (optimization.hasHashMap) techniques.push('hash map');
  if (optimization.hasTwoPointers) techniques.push('two pointers');
  if (optimization.hasBinarySearch) techniques.push('binary search');
  if (optimization.hasDPTable) techniques.push('dynamic programming');
  if (optimization.hasSlidingWindow) techniques.push('sliding window');
  if (optimization.hasSortingCall) techniques.push('sorting');
  const detectedTechniques =
    techniques.length > 0 ? techniques.join(', ') : 'none detected';

  const qualityWarnings =
    syntax.errors.map((e) => e.message).join(', ') || 'Clean';

  const raw = [
    `Calculated Time Complexity: ${complexity.timeComplexity}`,
    `Calculated Space Complexity: ${complexity.spaceComplexity}`,
    `Nesting Depth: ${complexity.nestingDepth} | Recursion: ${complexity.hasRecursion} | Confidence: ${complexity.confidence}`,
    `Optimization Signals: ${optimization.detectedStructures.join(', ') || 'None detected'}`,
    `Code Quality Warnings: ${qualityWarnings}`,
  ].join('\n');

  return {
    complexity: complexity.timeComplexity,
    approach,
    detectedTechniques,
    qualityWarnings,
    raw,
  };
}

// ── Safe truncation (cuts at line boundary, not mid-statement) ────────────────

function safeTruncate(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text || '';
  const truncated = text.substring(0, maxChars);
  const lastNewline = truncated.lastIndexOf('\n');
  if (lastNewline > maxChars * 0.5) {
    return truncated.substring(0, lastNewline) + '\n// ... (truncated)';
  }
  return truncated + '... (truncated)';
}

// ── Editorial grounding (DB only) ─────────────────────────────────────────────

interface EditorialGrounding {
  statement: string;
  editorial: string;
  solutions: string;
}

async function fetchEditorialGrounding(problemUrl: string | undefined): Promise<EditorialGrounding> {
  const empty: EditorialGrounding = {
    statement: 'Not available',
    editorial: 'Not available',
    solutions: 'Not available',
  };
  if (!problemUrl) return empty;

  try {
    // Try exact match first, then fall back to prefix match (ignoring query params).
    // The DB may store a URL with ?envType=... while the frontend sends the clean URL,
    // or vice versa.
    let problem = await prisma.problem.findFirst({ where: { url: problemUrl } });

    if (!problem) {
      // Strip query params and trailing slash, then try a prefix match.
      const cleanUrl = problemUrl.split('?')[0].replace(/\/$/, '');
      problem = await prisma.problem.findFirst({
        where: { url: { startsWith: cleanUrl } },
      });
    }

    if (!problem) {
      // Last resort: try contains match on the path portion.
      try {
        const urlObj = new URL(problemUrl);
        const path = urlObj.pathname;
        problem = await prisma.problem.findFirst({
          where: { url: { contains: path } },
        });
      } catch {
        // Not a valid URL — skip
      }
    }

    if (!problem || !problem.data) return empty;

    const parsed = JSON.parse(problem.data) as {
      content?: { problemStatementMarkdown?: string; editorialMarkdown?: string };
      referenceSolutions?: Array<{ code: string; language: string }>;
    };

    const editorial = parsed.content?.editorialMarkdown ?? 'Not available';
    const statement = parsed.content?.problemStatementMarkdown ?? 'Not available';
    const solutions =
      parsed.referenceSolutions && parsed.referenceSolutions.length > 0
        ? parsed.referenceSolutions
            .map((sol, i) => `Solution ${i + 1} (${sol.language}):\n${sol.code}`)
            .join('\n\n')
        : 'Not available';

    return { statement, editorial, solutions };
  } catch (e) {
    console.error('DB Editorial fetch failed', e);
    return empty;
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    // ── Auth + Rate limit ──────────────────────────────────────────────────
    const authUser = await getAuthUser();
    if (!authUser) return unauthorized();

    const rl = rateLimit(`hint:${authUser.userId}`, RATE_LIMITS.hint);
    if (!rl.allowed) return tooManyRequests(rl.resetAt);

    const {
      code,
      language,
      problemTitle,
      problemUrl,
      problemStatement,
      problemTags,
      userMessage,
      messages,
    } = await req.json();

    // 1. Resolve AI provider (uses shared ai-providers module)
    const provider = await getActiveProvider();
    if (!provider) {
      return NextResponse.json(
        {
          error: 'NO_API_KEY',
          message:
            'Please configure an API key in Settings (⚙) to receive live AI mentor hints.',
        },
        { status: 400 }
      );
    }

    // 2. AST structural analysis via the CodeAnalysisEngine.
    let assessment: StructuralAssessment | null = null;
    try {
      const engine = new CodeAnalysisEngine();
      const report = await engine.analyse({
        code: code || '',
        language: language || 'cpp17',
      });
      assessment = assessStructure(report);
    } catch (e) {
      console.error('AST analysis failed', e);
    }

    const astSection = assessment
      ? `The student's AST reveals a ${assessment.approach} approach.
Detected techniques: ${assessment.detectedTechniques}
Calculated complexity: ${assessment.complexity}
${assessment.raw}`
      : 'Static analysis unavailable for this submission.';

    // 3. RAG — fetch the user's historical Coding Style Profile
    let ragContext = 'No historical coding profile found.';
    try {
      ragContext = await retrieveUserProfileContext(authUser.userId, problemTitle || '', problemTags || []);
    } catch (e) {
      console.error('RAG retrieval failed', e);
    }

    // 4. Fetch the AUTHORITATIVE editorial from the database (never trust frontend)
    const grounding = await fetchEditorialGrounding(problemUrl);

    const cleanStatement = (grounding.statement !== 'Not available'
      ? grounding.statement
      : problemStatement || ''
    )
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // 5. Build system prompt — simple, conversational, but with coding style enforcement
    const systemPrompt = `You are CodeOn, a real-time coding mentor. You're not a rule-based bot — you're a senior competitive programmer who knows this student personally.

You're mentoring them on: ${problemTitle || 'a coding problem'}
${safeTruncate(cleanStatement, 800)}

Here's what you know that the student doesn't (use silently):
- Editorial: ${grounding.editorial === 'Not available' ? 'N/A — infer the optimal approach from the problem' : safeTruncate(grounding.editorial, 1500)}
- Reference solutions: ${grounding.solutions === 'Not available' ? 'N/A' : safeTruncate(grounding.solutions, 800)}

Their current code:
\`\`\`${language || 'cpp'}
${code ? safeTruncate(code, 1500) : 'No code yet'}
\`\`\`

Code analysis (your assessment):
${astSection}

WHO IS THIS STUDENT (from their past submissions):
${ragContext}

HOW YOU BEHAVE:
- You're a real person talking to a real person. Conversational. Natural. Not robotic.
- You remember the conversation. If they asked about their bug 3 messages ago, don't repeat yourself.

RESPONSE MODES (CRITICAL — follow strictly):
1. "Give me a hint" → Short nudge. 1-2 sentences. Point direction. No code.
2. "What's wrong with my code" / "why is it not working" / "debug this" → Name the exact bug in 1-2 sentences. NO CODE. "Your sort is sorting the + signs too." Not "think about what happens."
3. "Why is it not printing" → Answer directly. "Your code is waiting for input." NO CODE.
4. "Show me the code" / "give me the solution" / "implement it" → THEN give full code. In their coding style.
5. Wrong problem → Tell them once, clearly. "This isn't Two Sum." Then hint at right approach.

NEVER give code unless the user EXPLICITLY asks for it with words like "show code", "give solution", "implement", "write the code".
"What's wrong" is NOT a code request. "Help me" is NOT a code request. Only explicit "show me" = code.

- Match their coding style when you DO write code. ${ragContext.includes('No historical') ? 'Use clean competitive C++: fast I/O, bits/stdc++.h, short variable names.' : 'Use their patterns from above.'}
- Keep it SHORT unless they ask for detail. 2-3 sentences for most responses.
- You can be funny, encouraging, or direct — match their energy.`;

    // 6. Build conversation messages for the LLM
    let chatMessages: Array<{ role: "user" | "assistant" | "system"; content: string }>;

    if (messages && Array.isArray(messages) && messages.length > 0) {
      // Frontend sent conversation history — prepend system prompt
      chatMessages = [
        { role: "system", content: systemPrompt },
        ...messages,
      ];
    } else {
      // No history — single shot
      chatMessages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage || 'Give me a hint on how to improve my solution.' },
      ];
    }

    // 7. Stream the response via the shared provider module
    const stream = await streamCompletion(provider, '', {
      temperature: 0.3,
      maxTokens: 4096,
      messages: chatMessages,
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error: unknown) {
    console.error('Error in /api/hint:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate AI hint';
    return NextResponse.json(
      { error: 'AI_ERROR', message },
      { status: 503 }
    );
  }
}
