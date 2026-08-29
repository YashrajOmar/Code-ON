/**
 * Code Analysis Engine — main orchestrator.
 */

import { parseCode } from './parser';
import { buildCFG } from './cfg-builder';
import { analyseSyntax } from './layers/syntax';
import { analyseComplexity } from './layers/complexity';
import { analyseSemantic } from './layers/semantic';
import { analyseMemory } from './layers/memory';
import { analyseStyle } from './layers/style';
import { detectOptimizationSignals } from './layers/optimization-signals';
import type { AnalysisInput, CodeAnalysisReport } from './types';

export class CodeAnalysisEngine {
  async analyse(input: AnalysisInput): Promise<CodeAnalysisReport> {
    const startTime = Date.now();

    const parseResult = await parseCode(input.code, input.language);
    const cfg = buildCFG(parseResult.root);

    const [syntax, complexity, semantic, memory, style, optimization] = [
      analyseSyntax(parseResult.root, parseResult.hasParseErrors),
      analyseComplexity(cfg, parseResult.root),
      analyseSemantic(parseResult.root),
      analyseMemory(parseResult.root, input.language),
      analyseStyle(parseResult.root, parseResult.linesOfCode),
      detectOptimizationSignals(parseResult.root),
    ];

    return {
      input,
      parseResult,
      cfg,
      syntax,
      complexity,
      semantic,
      memory,
      style,
      optimization,
      analysisTimeMs: Date.now() - startTime,
      analysisTimestamp: new Date(),
    };
  }

  async getOptimizationSignals(input: AnalysisInput) {
    const report = await this.analyse(input);
    return report.optimization;
  }

  async getStyleSignals(input: AnalysisInput) {
    const report = await this.analyse(input);
    return report.style;
  }
}
