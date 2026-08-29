/**
 * Style Evolution Engine — prescriptive coding style progression.
 *
 * Tracks the student's current style stage and prescribes the NEXT concrete
 * improvement. Progression is always one stage at a time — never jumps.
 *
 * The engine observes style signals from code analysis reports and
 * determines when the student is ready to move to the next stage.
 *
 * Important: The engine does NOT enforce style. It prescribes.
 * The Teaching Engine delivers the prescription as a Socratic suggestion.
 */

import type { StyleStage } from '../entities/common.js';
import type { StyleImprovement } from '../entities/student-profile.js';

/**
 * Signals extracted from code analysis that indicate style level.
 */
export interface StyleSignals {
  readonly averageVariableNameLength: number;     // < 3 chars = naive naming
  readonly hasHelperFunctions: boolean;
  readonly hasConstexprOrConst: boolean;
  readonly usesRangeBasedFor: boolean;
  readonly usesAutoKeyword: boolean;
  readonly usesStdRanges: boolean;
  readonly usesStructuredBindings: boolean;
  readonly magicNumberCount: number;              // Unaliased numeric literals
  readonly maxFunctionLength: number;             // In lines of code
  readonly hasComments: boolean;
  readonly singleLetterVariableCount: number;
  readonly hasGodFunction: boolean;               // Single function > 50 lines
}

/**
 * Prescriptions for each transition between style stages.
 * Key: `${fromStage}->${toStage}`
 */
const STYLE_PRESCRIPTIONS: Partial<Record<string, StyleImprovement>> = {
  'naive->descriptive': {
    description: 'Use descriptive variable names instead of single letters',
    exampleBefore: 'int a, b, c;\\nfor (int i = 0; i < n; i++)',
    exampleAfter: 'int left, right, mid;\\nfor (int index = 0; index < size; index++)',
    rationale:
      'Descriptive names make code self-documenting and easier to debug during interviews.',
    targetStage: 'descriptive',
  },
  'descriptive->structured': {
    description: 'Extract repeated logic into helper functions',
    exampleBefore: '// 80-line main function doing everything',
    exampleAfter:
      'bool isValid(int x) { ... }\\nvoid processRange(vector<int>& v) { ... }',
    rationale:
      'Single-responsibility functions are easier to reason about and test independently.',
    targetStage: 'structured',
  },
  'structured->modern': {
    description: "Use 'const' and 'constexpr' for immutable values",
    exampleBefore: 'int MOD = 1e9 + 7;',
    exampleAfter: 'constexpr int MOD = 1e9 + 7;',
    rationale:
      "Compile-time constants communicate intent and enable compiler optimizations.",
    targetStage: 'modern',
  },
  'modern->idiomatic': {
    description: 'Use range-based for loops and structured bindings',
    exampleBefore: 'for (int i = 0; i < v.size(); i++) { auto p = v[i]; }',
    exampleAfter: 'for (auto& [key, value] : map) { }',
    rationale: 'Modern C++ idioms reduce boilerplate and make intent clearer.',
    targetStage: 'idiomatic',
  },
  'idiomatic->interview_quality': {
    description: 'Add brief inline comments for non-obvious logic',
    exampleBefore: 'while (left < right) { int mid = left + (right - left) / 2; }',
    exampleAfter:
      '// Avoid overflow: mid = left + (right - left) / 2\\nwhile (left < right) { int mid = left + (right - left) / 2; }',
    rationale:
      'Comments during interviews signal clarity of thought and communication skill.',
    targetStage: 'interview_quality',
  },
  'interview_quality->production_quality': {
    description: 'Use std::ranges algorithms and proper abstractions',
    exampleBefore: 'sort(v.begin(), v.end());',
    exampleAfter: 'std::ranges::sort(v);',
    rationale:
      'Production code should use the highest-level abstractions available to minimize error surface.',
    targetStage: 'production_quality',
  },
};

const STAGE_ORDER: StyleStage[] = [
  'naive',
  'descriptive',
  'structured',
  'modern',
  'idiomatic',
  'interview_quality',
  'production_quality',
];

/**
 * Infer the student's current style stage from code signals.
 * Returns the LOWEST stage whose signals are NOT yet met (i.e., current stage).
 */
export function inferStyleStage(signals: StyleSignals): StyleStage {
  if (signals.usesStdRanges && signals.usesStructuredBindings && signals.hasComments) {
    return 'production_quality';
  }
  if (signals.hasComments && signals.usesRangeBasedFor && signals.hasHelperFunctions) {
    return 'interview_quality';
  }
  if (signals.usesRangeBasedFor || signals.usesStructuredBindings || signals.usesAutoKeyword) {
    return 'idiomatic';
  }
  if (signals.hasConstexprOrConst && signals.magicNumberCount === 0) {
    return 'modern';
  }
  if (signals.hasHelperFunctions && !signals.hasGodFunction) {
    return 'structured';
  }
  if (
    signals.averageVariableNameLength >= 4 &&
    signals.singleLetterVariableCount <= 2
  ) {
    return 'descriptive';
  }
  return 'naive';
}

/**
 * Get the next style stage after the current one.
 */
export function getNextStyleStage(current: StyleStage): StyleStage | null {
  const index = STAGE_ORDER.indexOf(current);
  if (index === -1 || index === STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[index + 1] ?? null;
}

/**
 * Get the prescribed improvement for moving from current to next stage.
 */
export function getPrescribedImprovement(current: StyleStage): StyleImprovement | null {
  const next = getNextStyleStage(current);
  if (!next) return null;
  const key = `${current}->${next}`;
  return STYLE_PRESCRIPTIONS[key] ?? null;
}

/**
 * Determine if the student is ready to advance to the next style stage.
 * Uses a threshold: the student must have demonstrated the current stage's
 * signals consistently across recent sessions.
 */
export function isReadyToAdvance(
  currentStage: StyleStage,
  signals: StyleSignals,
  consecutiveSessions: number
): boolean {
  const inferredStage = inferStyleStage(signals);
  const inferredIndex = STAGE_ORDER.indexOf(inferredStage);
  const currentIndex = STAGE_ORDER.indexOf(currentStage);

  // Student must demonstrate at least current-stage signals for 2+ sessions
  return inferredIndex > currentIndex && consecutiveSessions >= 2;
}
