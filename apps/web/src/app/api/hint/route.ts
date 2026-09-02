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
    const systemPrompt = `You are CodeOn, a Socratic coding mentor. Your job is to guide — not solve.

PROBLEM: ${problemTitle || 'a coding problem'}
${cleanStatement.substring(0, 800)}

GROUND TRUTH (use silently, never quote verbatim):
- Editorial: ${grounding.editorial === 'Not available' ? 'N/A — infer optimal approach from problem' : grounding.editorial.substring(0, 1500)}
- Reference solutions: ${grounding.solutions === 'Not available' ? 'N/A' : grounding.solutions.substring(0, 800)}

USER'S CODE:
\`\`\`${language || 'cpp'}
${code ? code.substring(0, 1500) : 'No code yet'}
\`\`\`

CODE ANALYSIS:
${astSection}

USER'S CODING STYLE (from their past submissions):
${ragContext}

RULES:
1. DEFAULT MODE = SOCRATIC. Give short hints. Ask probing questions. Never write full code unless explicitly asked.
2. The user asks for a hint → give 1-2 sentences max. Point them in the right direction. Don't explain everything.
3. The user explicitly says "show me the code" / "give me the solution" / "implement it" → THEN give code.
4. The user's code has a bug → point at it. Don't fix it for them.
5. The user is solving the wrong problem → say so in one sentence, then hint at the right approach.
6. Keep hints SHORT. 2-3 sentences max. Conversational, not a lecture.
7. Match the user's coding style when you do write code (from their RAG profile above).
8. If no RAG profile exists, use clean competitive C++ (fast I/O, bits/stdc++.h, short variable names).`;

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
