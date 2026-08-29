/**
 * Recommendation Engine — multidimensional next-step recommendations.
 *
 * Produces a RecommendationSet with 6 dimensions:
 *   1. next_problem       — Problem optimally challenging for the student
 *   2. next_topic         — Concept to study based on Knowledge Graph gaps
 *   3. next_article       — External resource for weak concepts
 *   4. next_visualization — Animated explanation for hard concepts
 *   5. next_review        — Spaced repetition due item
 *   6. next_simulation    — Interview simulation when student is ready
 *
 * Combines: Elo + Knowledge Graph + Spaced Repetition + Failure Patterns
 */

import type { ConceptId, ProblemId } from '../entities/common.js';
import type { DifficultyPrediction } from './difficulty-predictor.js';
import type { ForgettingCurveState } from './forgetting-curve.js';

export interface ProblemCandidate {
  readonly problemId: ProblemId;
  readonly problemElo: number;
  readonly requiredConceptIds: ConceptId[];
  readonly tags: string[];
  readonly slug: string;
  readonly title: string;
}

export interface ConceptCandidate {
  readonly conceptId: ConceptId;
  readonly name: string;
  readonly mastery: number;
  readonly interviewImportance: number;
}

export interface ResourceItem {
  readonly title: string;
  readonly url: string;
  readonly type: 'article' | 'video' | 'visualization' | 'interactive';
  readonly conceptId: ConceptId;
  readonly estimatedMinutes: number;
}

export interface RecommendationInput {
  readonly studentElo: number;
  readonly studentMastery: Map<ConceptId, number>;
  readonly forgettingStates: ForgettingCurveState[];
  readonly recentFailedConceptIds: ConceptId[];
  readonly recentSolvedProblemIds: ProblemId[];
  readonly interviewReadinessScore: number;
  readonly availableProblemCandidates: ProblemCandidate[];
  readonly availableConceptCandidates: ConceptCandidate[];
  readonly availableResources: ResourceItem[];
}

export interface ProblemRecommendation {
  readonly problemId: ProblemId;
  readonly title: string;
  readonly slug: string;
  readonly prediction: DifficultyPrediction;
  readonly reason: string;
}

export interface ConceptRecommendation {
  readonly conceptId: ConceptId;
  readonly name: string;
  readonly currentMastery: number;
  readonly reason: string;
}

export interface ReviewRecommendation {
  readonly conceptId: ConceptId;
  readonly problemId: ProblemId | null;
  readonly forgettingProbability: number;
  readonly daysOverdue: number;
  readonly urgency: 'low' | 'medium' | 'high';
}

export interface SimulationRecommendation {
  readonly mode: 'google' | 'meta' | 'amazon' | 'generic';
  readonly estimatedDuration: number;
  readonly reason: string;
}

export interface RecommendationSet {
  readonly nextProblem: ProblemRecommendation | null;
  readonly nextTopic: ConceptRecommendation | null;
  readonly nextArticle: ResourceItem | null;
  readonly nextVisualization: ResourceItem | null;
  readonly nextReview: ReviewRecommendation | null;
  readonly nextInterviewSimulation: SimulationRecommendation | null;
  readonly generatedAt: Date;
}

const OPTIMAL_SUCCESS_RATE_MIN = 0.45;
const OPTIMAL_SUCCESS_RATE_MAX = 0.75;

/**
 * Find the most urgent spaced repetition review.
 */
function findUrgentReview(states: ForgettingCurveState[]): ReviewRecommendation | null {
  const overdue = states
    .filter((s) => s.forgettingProbability > 0.5 && s.nextReviewAt <= new Date())
    .sort((a, b) => b.forgettingProbability - a.forgettingProbability);

  if (overdue.length === 0) return null;

  const top = overdue[0];
  if (!top) return null;

  const daysOverdue = Math.round(
    (new Date().getTime() - top.nextReviewAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    conceptId: top.conceptId as ConceptId,
    problemId: null, // Problem assignment happens at the API layer
    forgettingProbability: top.forgettingProbability,
    daysOverdue,
    urgency:
      top.forgettingProbability > 0.8
        ? 'high'
        : top.forgettingProbability > 0.65
        ? 'medium'
        : 'low',
  };
}

/**
 * Find the weakest concept that is high-importance and not in active study.
 */
function findWeakestImportantConcept(
  candidates: ConceptCandidate[],
  recentFailed: ConceptId[]
): ConceptRecommendation | null {
  // Prioritize recently failed concepts
  const recentFailedConcept = candidates.find(
    (c) => recentFailed.includes(c.conceptId) && c.mastery < 0.5
  );

  if (recentFailedConcept) {
    return {
      conceptId: recentFailedConcept.conceptId,
      name: recentFailedConcept.name,
      currentMastery: recentFailedConcept.mastery,
      reason: 'You struggled with this concept recently. Focused practice will help.',
    };
  }

  // Otherwise pick lowest mastery * highest importance
  const scored = candidates
    .filter((c) => c.mastery < 0.7)
    .map((c) => ({ ...c, score: (1 - c.mastery) * c.interviewImportance }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top) return null;

  return {
    conceptId: top.conceptId,
    name: top.name,
    currentMastery: top.mastery,
    reason: `This is a high-importance concept with current mastery at ${Math.round(top.mastery * 100)}%.`,
  };
}

/**
 * Determine if the student is ready for interview simulation.
 */
function maybeRecommendSimulation(
  interviewReadinessScore: number
): SimulationRecommendation | null {
  if (interviewReadinessScore < 60) return null;

  return {
    mode: interviewReadinessScore >= 80 ? 'google' : 'generic',
    estimatedDuration: 45,
    reason: `Your interview readiness score is ${interviewReadinessScore}/100. Time to practice under pressure.`,
  };
}

/**
 * Build a multidimensional recommendation set.
 * Pure function — all input must be pre-loaded.
 */
export function buildRecommendationSet(
  input: RecommendationInput,
  problemPredictions: Map<ProblemId, DifficultyPrediction>
): RecommendationSet {
  // 1. Next Problem — find the one closest to optimal challenge zone
  const optimalProblem = input.availableProblemCandidates
    .map((p) => ({ candidate: p, prediction: problemPredictions.get(p.problemId) }))
    .filter(
      (x): x is { candidate: ProblemCandidate; prediction: DifficultyPrediction } =>
        x.prediction !== undefined &&
        x.prediction.expectedSuccessRate >= OPTIMAL_SUCCESS_RATE_MIN &&
        x.prediction.expectedSuccessRate <= OPTIMAL_SUCCESS_RATE_MAX
    )
    .filter((x) => !input.recentSolvedProblemIds.includes(x.candidate.problemId))
    .sort(
      (a, b) =>
        Math.abs(a.prediction.expectedSuccessRate - 0.6) -
        Math.abs(b.prediction.expectedSuccessRate - 0.6)
    )[0];

  const nextProblem = optimalProblem
    ? {
        problemId: optimalProblem.candidate.problemId,
        title: optimalProblem.candidate.title,
        slug: optimalProblem.candidate.slug,
        prediction: optimalProblem.prediction,
        reason: `Expected success rate: ${Math.round(optimalProblem.prediction.expectedSuccessRate * 100)}%. Optimal challenge level for you.`,
      }
    : null;

  // 2. Next Topic
  const nextTopic = findWeakestImportantConcept(
    input.availableConceptCandidates,
    input.recentFailedConceptIds
  );

  // 3. Resources
  const weakConceptId = nextTopic?.conceptId;
  const nextArticle = weakConceptId
    ? (input.availableResources.find(
        (r) => r.conceptId === weakConceptId && r.type === 'article'
      ) ?? null)
    : null;

  const nextVisualization = weakConceptId
    ? (input.availableResources.find(
        (r) =>
          r.conceptId === weakConceptId &&
          (r.type === 'visualization' || r.type === 'interactive')
      ) ?? null)
    : null;

  // 4. Spaced Repetition Review
  const nextReview = findUrgentReview(input.forgettingStates);

  // 5. Interview Simulation
  const nextInterviewSimulation = maybeRecommendSimulation(input.interviewReadinessScore);

  return {
    nextProblem,
    nextTopic,
    nextArticle,
    nextVisualization,
    nextReview,
    nextInterviewSimulation,
    generatedAt: new Date(),
  };
}

