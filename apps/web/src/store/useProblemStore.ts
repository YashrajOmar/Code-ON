import { create } from 'zustand';
import type { ScrapedProblem } from '@codeon/scrapers';

export interface TestCase {
  id: string;
  input: string;
  expectedOutput: string;
  actualOutput?: string;
  status?: 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL';
}

interface ProblemState {
  activeProblem: ScrapedProblem | null;
  testCases: TestCase[];
  setScrapedProblem: (problem: ScrapedProblem) => void;
  updateTestCaseOutput: (id: string, actualOutput: string, status: 'PASS' | 'FAIL') => void;
  addTestCase: () => void;
  deleteTestCase: (id: string) => void;
  resetTestCases: () => void;
  updateTestCaseInput: (id: string, input: string) => void;
  updateTestCaseExpected: (id: string, expectedOutput: string) => void;
}

export const useProblemStore = create<ProblemState>((set) => ({
  activeProblem: null,
  testCases: [],

  setScrapedProblem: (problem: ScrapedProblem) => {
    // Dynamically transform scraped examples into IDE testcases
    const freshTestCases: TestCase[] = problem.examples.map((ex, index) => ({
      id: `test-${index + 1}`,
      input: ex.input,
      expectedOutput: ex.output,
      actualOutput: undefined,
      status: 'IDLE',
    }));

    set({
      activeProblem: problem,
      testCases: freshTestCases, // Replaces stale/hardcoded test cases!
    });
  },

  updateTestCaseOutput: (id: string, actualOutput: string, status: 'PASS' | 'FAIL') =>
    set((state) => ({
      testCases: state.testCases.map((tc) =>
        tc.id === id ? { ...tc, actualOutput, status } : tc
      ),
    })),

  addTestCase: () =>
    set((state) => {
      const newId = `test-${Date.now()}`;
      return {
        testCases: [
          ...state.testCases,
          { id: newId, input: '', expectedOutput: '', status: 'IDLE' },
        ],
      };
    }),

  deleteTestCase: (id: string) =>
    set((state) => ({
      testCases: state.testCases.filter((tc) => tc.id !== id),
    })),

  resetTestCases: () =>
    set((state) => {
      if (!state.activeProblem) return state;
      return {
        testCases: state.activeProblem.examples.map((ex, index) => ({
          id: `test-${index + 1}`,
          input: ex.input,
          expectedOutput: ex.output,
          actualOutput: undefined,
          status: 'IDLE',
        })),
      };
    }),

  updateTestCaseInput: (id: string, input: string) =>
    set((state) => ({
      testCases: state.testCases.map((tc) =>
        tc.id === id ? { ...tc, input, status: 'IDLE', actualOutput: undefined } : tc
      ),
    })),

  updateTestCaseExpected: (id: string, expectedOutput: string) =>
    set((state) => ({
      testCases: state.testCases.map((tc) =>
        tc.id === id ? { ...tc, expectedOutput, status: 'IDLE', actualOutput: undefined } : tc
      ),
    })),
}));
