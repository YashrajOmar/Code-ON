/**
 * Trail Engine — Native Optimization Trail.
 *
 * Detects the student's current algorithmic level from code characteristics
 * and constructs an ordered trail from their current position to the optimal solution.
 *
 * Key principle: The trail is always derived from VERIFIED editorial data, not from
 * LLM inference. The LLM only generates the Socratic hint to guide the next step.
 *
 * Levels are detected by recognizing patterns in:
 *   - Data structures used
 *   - Complexity signals from static analysis
 *   - Loop nesting depth
 *   - Known algorithmic patterns (two pointers, sliding window, etc.)
 */

import type { AlgorithmicLevel } from '../entities/common.js';
import type { OptimizationStep, OptimizationTrail } from '../entities/problem.js';

export interface CodePatternSignals {
  /** Number of nested loop levels (e.g., 2 = O(n²) at minimum) */
  readonly nestedLoopDepth: number;
  /** True if any sorting call is detected (sort/qsort/priority_queue) */
  readonly hasSortingCall: boolean;
  /** True if binary search pattern is detected */
  readonly hasBinarySearch: boolean;
  /** True if a hash map / unordered_map is used */
  readonly hasHashMap: boolean;
  /** True if a two-pointer pattern is detectable */
  readonly hasTwoPointers: boolean;
  /** True if a monotonic stack/queue pattern is present */
  readonly hasMonotonicStructure: boolean;
  /** True if dynamic programming table/memo is detected */
  readonly hasDPTable: boolean;
  /** True if graph adjacency list or matrix is present */
  readonly hasGraphStructure: boolean;
  /** True if a heap / priority_queue is used */
  readonly hasHeap: boolean;
  /** True if a segment tree or BIT/Fenwick is used */
  readonly hasAdvancedDS: boolean;
  /** True if union-find (DSU) is detected */
  readonly hasDSU: boolean;
  /** True if prefix sum array is built */
  readonly hasPrefixSum: boolean;
  /** True if a sliding window variable tracking max/min is present */
  readonly hasSlidingWindow: boolean;
}

/**
 * Detect the most likely algorithmic level from code pattern signals.
 * Returns the HIGHEST level supported by the detected signals.
 * Pure function — no I/O.
 */
export function detectAlgorithmicLevel(signals: CodePatternSignals): AlgorithmicLevel {
  // Check from most advanced to least — return first match
  if (signals.hasAdvancedDS) return 'advanced_data_structure';
  if (signals.hasDSU && signals.hasGraphStructure) return 'advanced_data_structure';
  if (signals.hasDPTable) return 'dynamic_programming';
  if (signals.hasGraphStructure && (signals.hasHeap || signals.hasBinarySearch)) {
    return 'advanced_data_structure';
  }
  if (signals.hasGraphStructure) return 'graph_traversal';
  if (signals.hasHeap || signals.hasMonotonicStructure) return 'greedy';
  if (signals.hasSlidingWindow) return 'sliding_window';
  if (signals.hasPrefixSum) return 'prefix_sum';
  if (signals.hasHashMap) return 'hash_map';
  if (signals.hasBinarySearch) return 'binary_search';
  if (signals.hasTwoPointers) return 'two_pointer';
  if (signals.hasSortingCall) return 'sorting';
  if (signals.nestedLoopDepth === 2) return 'naive_optimized';
  return 'brute_force';
}

/**
 * Ordered sequence of all algorithmic levels from worst to best.
 */
const LEVEL_ORDER: AlgorithmicLevel[] = [
  'brute_force',
  'naive_optimized',
  'sorting',
  'two_pointer',
  'binary_search',
  'hash_map',
  'prefix_sum',
  'sliding_window',
  'greedy',
  'divide_and_conquer',
  'dynamic_programming',
  'graph_traversal',
  'advanced_data_structure',
  'mathematical',
  'optimal',
];

/**
 * Get the index of a level in the ordered sequence.
 */
export function getLevelIndex(level: AlgorithmicLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

/**
 * Compute the trail from the student's current position to the optimal.
 * Returns only the steps AHEAD of the student's current level.
 * Pure function — requires pre-computed trail from editorial data.
 */
export function computeRemainingTrail(
  fullTrail: OptimizationTrail,
  currentLevel: AlgorithmicLevel
): OptimizationStep[] {
  const currentIndex = getLevelIndex(currentLevel);
  return fullTrail.steps.filter((step) => {
    const stepIndex = getLevelIndex(step.level as AlgorithmicLevel);
    return stepIndex > currentIndex;
  });
}

/**
 * Get the immediate next step on the optimization trail.
 * This is the step the student should be guided toward next.
 */
export function getNextTrailStep(
  fullTrail: OptimizationTrail,
  currentLevel: AlgorithmicLevel
): OptimizationStep | null {
  const remaining = computeRemainingTrail(fullTrail, currentLevel);
  return remaining[0] ?? null;
}

/**
 * Compute how many optimization steps remain to the optimal.
 */
export function computeDistanceToOptimal(
  fullTrail: OptimizationTrail,
  currentLevel: AlgorithmicLevel
): number {
  return computeRemainingTrail(fullTrail, currentLevel).length;
}

/**
 * Determine if the student has reached the optimal solution for this problem.
 */
export function hasReachedOptimal(
  fullTrail: OptimizationTrail,
  currentLevel: AlgorithmicLevel
): boolean {
  return computeDistanceToOptimal(fullTrail, currentLevel) === 0;
}

// ── TrailMilestone: the output contract for the API ──────────────────────────

export interface TrailMilestone {
  tier: 'Brute Force' | 'Sub-Optimal' | 'Optimal';
  complexity: { time: string; space: string };
  hint: string;
  algorithmicPivot: string;
  level: AlgorithmicLevel;
}

export interface GenerateTrailInput {
  signals: CodePatternSignals;
  timeComplexity: string;
  spaceComplexity: string;
  editorialMarkdown: string | null;
  problemTags: string[];
}

export interface GenerateTrailOutput {
  currentLevel: AlgorithmicLevel;
  milestones: TrailMilestone[];
  currentIndex: number;
}

// ── Complexity → level mapping ───────────────────────────────────────────────

function complexityToLevel(time: string, signals: CodePatternSignals): AlgorithmicLevel {
  const t = time.toLowerCase();
  if (t.includes('1') || t.includes('constant')) return 'optimal';
  if (t.includes('log')) return 'binary_search';
  if (t.includes('n²') || t.includes('n^2') || (t.includes('n') && t.includes('*') && t.includes('n'))) return 'naive_optimized';
  if (t.includes('n log n')) return 'sorting';
  if (t.includes('n')) {
    if (signals.hasHashMap) return 'hash_map';
    if (signals.hasSlidingWindow) return 'sliding_window';
    if (signals.hasTwoPointers) return 'two_pointer';
    return 'sorting';
  }
  return 'brute_force';
}

// ── Build milestones from signals + editorial ─────────────────────────────────

function buildDefaultTrail(signals: CodePatternSignals, tags: string[]): TrailMilestone[] {
  const tagList = tags.map(t => t.toLowerCase());
  const milestones: TrailMilestone[] = [];

  // Always start with brute force
  milestones.push({
    tier: 'Brute Force',
    complexity: { time: 'O(n²)', space: 'O(1)' },
    hint: 'Start with a nested loop — check all pairs.',
    algorithmicPivot: 'Nested loop over all elements',
    level: 'brute_force' as AlgorithmicLevel,
  });

  // Check if tags suggest specific optimizations
  if (tagList.some(t => t.includes('sort') || t.includes('two') || t.includes('pointer'))) {
    milestones.push({
      tier: 'Sub-Optimal',
      complexity: { time: 'O(n log n)', space: 'O(1)' },
      hint: 'Sort the array first, then use two pointers.',
      algorithmicPivot: 'Sort + two-pointer scan',
      level: 'sorting' as AlgorithmicLevel,
    });
  }

  if (tagList.some(t => t.includes('hash') || t.includes('map') || t.includes('array'))) {
    milestones.push({
      tier: 'Optimal',
      complexity: { time: 'O(n)', space: 'O(n)' },
      hint: 'Use a hash map for O(1) lookups in a single pass.',
      algorithmicPivot: 'Replace inner loop with hash map lookup',
      level: 'hash_map' as AlgorithmicLevel,
    });
  } else if (tagList.some(t => t.includes('dp') || t.includes('dynamic'))) {
    milestones.push({
      tier: 'Optimal',
      complexity: { time: 'O(n)', space: 'O(n)' },
      hint: 'Build a DP table to avoid recomputation.',
      algorithmicPivot: 'Memoize overlapping subproblems',
      level: 'dynamic_programming' as AlgorithmicLevel,
    });
  } else if (tagList.some(t => t.includes('binary') || t.includes('search'))) {
    milestones.push({
      tier: 'Optimal',
      complexity: { time: 'O(log n)', space: 'O(1)' },
      hint: 'Binary search on the answer space.',
      algorithmicPivot: 'Binary search on monotonic property',
      level: 'binary_search' as AlgorithmicLevel,
    });
  } else if (milestones.length === 1) {
    milestones.push({
      tier: 'Optimal',
      complexity: { time: 'O(n)', space: 'O(1)' },
      hint: 'Find a single-pass solution with careful state tracking.',
      algorithmicPivot: 'Single pass with state tracking',
      level: 'optimal' as AlgorithmicLevel,
    });
  }

  return milestones;
}

// ── Extract complexity hints from editorial text ─────────────────────────────

function extractEditorialHints(editorial: string): { optimalComplexity?: string; approach?: string } {
  if (!editorial) return {};
  const lower = editorial.toLowerCase();
  const complexityMatch = lower.match(/(?:time complexity|complexity)[:\s]*o\(([^)]+)\)/i);
  const approachMatch = editorial.match(/(?:approach|solution|intuition)[:\s]*([\s\S]{10,200}?)(?:\n#|\n##|complexity|$)/i);
  return {
    optimalComplexity: complexityMatch ? `O(${complexityMatch[1]})` : undefined,
    approach: approachMatch ? approachMatch[1].trim() : undefined,
  };
}

// ── Main: generateTrail ───────────────────────────────────────────────────────

export function generateTrail(input: GenerateTrailInput): GenerateTrailOutput {
  const { signals, timeComplexity, spaceComplexity, editorialMarkdown, problemTags } = input;

  // 1. Detect current level from signals
  const currentLevel = detectAlgorithmicLevel(signals);

  // 2. Build milestones (from editorial if available, else from tags)
  let milestones = buildDefaultTrail(signals, problemTags);

  if (editorialMarkdown && editorialMarkdown.length > 50) {
    const hints = extractEditorialHints(editorialMarkdown);
    // If editorial mentions a complexity, enrich the optimal milestone
    if (hints.optimalComplexity && milestones.length > 0) {
      const lastMilestone = milestones[milestones.length - 1];
      milestones[milestones.length - 1] = {
        ...lastMilestone,
        complexity: { time: hints.optimalComplexity, space: lastMilestone.complexity.space },
        hint: hints.approach || lastMilestone.hint,
      };
    }
  }

  // 3. Find current index (which milestone the user is at)
  const currentIndex = milestones.findIndex(m => getLevelIndex(m.level) >= getLevelIndex(currentLevel));

  return {
    currentLevel,
    milestones,
    currentIndex: currentIndex >= 0 ? currentIndex : 0,
  };
}
