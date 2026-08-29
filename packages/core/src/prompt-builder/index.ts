/**
 * Prompt Builder — assembles the full LLM context from structured domain data.
 *
 * Design principles:
 *   1. Pure function — no I/O, no side effects
 *   2. Split into 5 independent context objects that are merged into a PromptPayload
 *   3. Every field has a defined fallback for cold-start (new users)
 *   4. The Teaching Engine receives a PromptPayload — never raw data
 *
 * Cold-start handling:
 *   When a student has no history, UserContext falls back to
 *   "Standard Strict Interviewer" persona — no personalization assumed.
 *   This is safer than assuming style preferences.
 */

import type { SessionMode, TeachingStyle, AlgorithmicLevel } from '../entities/common.js';
import type { StudentProfileSummary, CodingStyleProfile } from '../entities/student-profile.js';
import type { ProblemStatement, EditorialSummary } from './context-types.js';
import type { PromptPayload, ConversationTurn } from '../ports/ITeachingEngine.js';
import type { MistakeRecord } from '../ports/IUserMemoryRetriever.js';

// ─── Context Objects ────────────────────────────────────────────────────────

export interface ProblemContext {
  /** The full problem statement. null in scratchpad mode. */
  readonly statement: ProblemStatement | null;
  /** Summary of the editorial approach. Never the full solution. */
  readonly editorialSummary: EditorialSummary | null;
  /** The optimal complexity target for this problem. */
  readonly optimalComplexity: string | null;
  /** The next hint on the optimization trail. */
  readonly currentTrailHint: string | null;
  /** How many steps remain to reach the optimal solution. */
  readonly stepsToOptimal: number | null;
}

export interface UserContext {
  /**
   * Student summary. null = cold start.
   * When null, the persona defaults to 'standard_strict_interviewer'.
   */
  readonly profile: StudentProfileSummary | null;
  readonly isNewUser: boolean;
  /** The cold-start persona applied when profile is unavailable. */
  readonly coldStartPersona: 'standard_strict_interviewer';
  readonly recentMistakes: MistakeRecord[];
  readonly currentTeachingStyle: TeachingStyle;
  readonly codingStyle: CodingStyleProfile | null;
  readonly styleStageDescription: string;
  readonly interviewReadinessScore: number;
}

export interface CodeContext {
  readonly rawCode: string;
  readonly language: string;
  /** Inferred Big-O time complexity from static analysis. */
  readonly inferredTimeComplexity: string | null;
  /** Inferred Big-O space complexity from static analysis. */
  readonly inferredSpaceComplexity: string | null;
  /** Human-readable style issues detected by code analysis. */
  readonly styleIssues: string[];
  /** Detected algorithmic level of the submitted code. */
  readonly detectedAlgorithmicLevel: AlgorithmicLevel | null;
  /** Total lines of code. */
  readonly linesOfCode: number;
}

export interface LearningContext {
  readonly sessionMode: SessionMode;
  /** How many hints have been given in this session. */
  readonly hintsGivenThisSession: number;
  /** The hint types used so far (to avoid repeating the same hint style). */
  readonly hintTypesUsed: string[];
  /** Concepts currently in focus. */
  readonly activeConceptNames: string[];
  /** The student's global Elo. */
  readonly studentElo: number;
}

export interface ExecutionContext {
  /** null if code has not been run yet, or if still PENDING. */
  readonly verdict: string | null;
  readonly passedCases: number | null;
  readonly totalCases: number | null;
  readonly runtimeMs: number | null;
  /** The first test case that failed, shown to help the student debug. */
  readonly firstFailingInput: string | null;
  readonly firstFailingExpected: string | null;
  readonly firstFailingActual: string | null;
  readonly compilationError: string | null;
  readonly isPending: boolean;
}

// ─── System Prompt Templates ─────────────────────────────────────────────────

const SOCRATIC_CORE_INSTRUCTIONS = `
You are a world-class programming mentor, not a solution generator.

Your fundamental constraints:
- NEVER write the student's implementation for them
- NEVER reveal the complete algorithm directly
- ALWAYS guide through questions and observations
- NEVER say "you should use X algorithm" — instead ask "what would happen if you tried X?"
- Keep hints concise (3-5 sentences maximum)
- One idea per hint
- If the student has made the same mistake before, mention it clearly
`.trim();

const INTERVIEW_MODE_INSTRUCTIONS = `
You are simulating a senior Google engineer conducting a technical interview.
Behavior rules:
- Acknowledge code correctness with minimal feedback
- Only provide hints if the student explicitly asks "can I have a hint?"
- Ask clarifying questions like a real interviewer would
- Evaluate communication, not just correctness
- Do not volunteer optimization suggestions unprompted
`.trim();

const SCRATCHPAD_MODE_INSTRUCTIONS = `
You are an experienced staff software engineer reviewing a colleague's code.
Behavior rules:
- There is no "correct" algorithm — this is open engineering
- Focus on correctness, edge cases, performance, and maintainability
- Ask about design decisions: "Why did you choose this approach?"
- Suggest alternatives as options, not mandates
`.trim();

const CONTEST_MODE_INSTRUCTIONS = `
Contest mode: The student is in active competition. Do NOT provide any coaching.
Only provide:
- Compilation error explanations (factual)
- Runtime error stack trace interpretation (factual)
No algorithm hints. No optimization suggestions. No style feedback.
`.trim();

// ─── Builder ─────────────────────────────────────────────────────────────────

function buildSystemInstructions(
  sessionMode: SessionMode,
  userCtx: UserContext
): string {
  const modeInstructions = {
    problem: SOCRATIC_CORE_INSTRUCTIONS,
    scratchpad: SCRATCHPAD_MODE_INSTRUCTIONS,
    interview: INTERVIEW_MODE_INSTRUCTIONS,
    contest: CONTEST_MODE_INSTRUCTIONS,
  }[sessionMode];

  const studentContext = userCtx.isNewUser
    ? `\nStudent context: New user — no history available.\nPersona: ${userCtx.coldStartPersona.replace(/_/g, ' ')}.\nAssume standard interview preparation level.`
    : `\nStudent profile:\n- Global Elo: ${userCtx.profile?.globalElo ?? 'unknown'}\n- Interview readiness: ${userCtx.interviewReadinessScore}/100\n- Coding style stage: ${userCtx.styleStageDescription}\n- Preferred teaching style: ${userCtx.currentTeachingStyle}\n- Primary language: ${userCtx.profile?.primaryLanguage ?? 'unknown'}`;

  const mistakeContext =
    userCtx.recentMistakes.length > 0
      ? `\nRecent recurring mistakes (use these to personalize hints):\n${userCtx.recentMistakes
  .slice(0, 3)
  .map((m) => `- ${m.description} (seen ${m.frequency}x)`)
  .join('\\n')}`
      : '';

  return [modeInstructions, studentContext, mistakeContext].filter(Boolean).join('\\n\\n');
}

function buildUserMessage(
  problemCtx: ProblemContext,
  codeCtx: CodeContext,
  executionCtx: ExecutionContext,
  learningCtx: LearningContext
): string {
  const parts: string[] = [];

  // Code block
  parts.push(`## Student's Current Code (${codeCtx.language})`);
  parts.push('```' + codeCtx.language);
  parts.push(codeCtx.rawCode);
  parts.push('```');

  // Static analysis findings
  if (codeCtx.inferredTimeComplexity) {
    parts.push(
      `**Static Analysis:** Time: ${codeCtx.inferredTimeComplexity}, Space: ${codeCtx.inferredSpaceComplexity ?? 'unknown'}`
    );
  }
  if (codeCtx.styleIssues.length > 0) {
    parts.push(`**Style issues detected:** ${codeCtx.styleIssues.slice(0, 3).join('; ')}`);
  }

  // Execution result
  if (executionCtx.isPending) {
    parts.push('**Execution:** In progress — provide feedback on code structure only.');
  } else if (executionCtx.verdict) {
    parts.push(
      `**Execution Result:** ${executionCtx.verdict} ` +
        `(${executionCtx.passedCases ?? 0}/${executionCtx.totalCases ?? 0} cases passed)`
    );
    if (executionCtx.verdict === 'WA' && executionCtx.firstFailingInput) {
      parts.push(
        `**Failing case:** Input: \\\`${executionCtx.firstFailingInput}\\\`` +
          ` → Expected: \\\`${executionCtx.firstFailingExpected}\\\`` +
          ` → Got: \\\`${executionCtx.firstFailingActual}\\\``
      );
    }
    if (executionCtx.compilationError) {
      parts.push(`**Compilation error:** ${executionCtx.compilationError}`);
    }
  }

  // Trail context
  if (problemCtx.currentTrailHint && learningCtx.sessionMode === 'problem') {
    parts.push(
      `**Optimization trail:** ${problemCtx.stepsToOptimal ?? '?'} step(s) to optimal ` +
        `(${problemCtx.optimalComplexity ?? 'unknown'}).`
    );
    parts.push(`Internal trail hint (DO NOT reveal directly): ${problemCtx.currentTrailHint}`);
  }

  // Hint count warning
  if (learningCtx.hintsGivenThisSession >= 5) {
    parts.push(
      `Note: Student has received ${learningCtx.hintsGivenThisSession} hints this session. ` +
        'Be slightly more direct, but still do not write the implementation.'
    );
  }

  return parts.join('\\n\\n');
}

/**
 * Build a PromptPayload from the 5 context objects.
 * Pure function — no I/O.
 */
export function buildPrompt(
  problemCtx: ProblemContext,
  userCtx: UserContext,
  codeCtx: CodeContext,
  learningCtx: LearningContext,
  executionCtx: ExecutionContext,
  conversationHistory: ConversationTurn[]
): PromptPayload {
  return {
    systemInstructions: buildSystemInstructions(learningCtx.sessionMode, userCtx),
    userMessage: buildUserMessage(problemCtx, codeCtx, executionCtx, learningCtx),
    conversationHistory,
    maxTokens: 512,   // Hints must be concise
    temperature: 0.3, // Low temperature for consistent, reliable guidance
  };
}
