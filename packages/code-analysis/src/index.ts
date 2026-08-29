/**
 * @codeon/code-analysis — public API
 */

export { CodeAnalysisEngine } from './engine';
export { parseCode, mockParse, initializeParser } from './parser';
export { buildCFG } from './cfg-builder';
export { analyseComplexity } from './layers/complexity';
export { detectOptimizationSignals } from './layers/optimization-signals';
export { analyseStyle } from './layers/style';
export { analyseSyntax } from './layers/syntax';
export { analyseSemantic } from './layers/semantic';
export { analyseMemory } from './layers/memory';

export type {
  AnalysisInput,
  ASTNode,
  ParseResult,
  ControlFlowGraph,
  CFGNode,
  CFGEdge,
  CodeAnalysisReport,
  ComplexityAnalysis,
  OptimizationSignals,
  StyleAnalysis,
  SyntaxAnalysis,
  SemanticAnalysis,
  MemoryAnalysis,
} from './types';
