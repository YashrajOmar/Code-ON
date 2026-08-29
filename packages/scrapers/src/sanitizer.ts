import { GoogleGenAI, Type } from '@google/genai';
import { ScrapedProblemSchema, ScrapedProblem, GeminiExtractionSchema } from './types';
import { postProcessExtraction } from './post-process';

const MAX_RETRIES = 2;

export interface ExtractionContext {
  url: string;
  platform: string;
  id?: string;
  apiKey?: string;
  model?: string;
}

/**
 * Strips or masks any potential API key tokens from error strings to prevent secret leakage in logs.
 */
function sanitizeErrorMessage(msg: string, apiKey?: string): string {
  let sanitized = msg;
  if (apiKey && apiKey.length > 6) {
    sanitized = sanitized.split(apiKey).join('***REDACTED_API_KEY***');
  }
  // Generic pattern for Google API Keys (AIzaSy...)
  sanitized = sanitized.replace(/AIzaSy[A-Za-z0-9_-]{33}/g, '***REDACTED_API_KEY***');
  return sanitized;
}

export async function extractProblemFromHtml(
  html: string, 
  context: ExtractionContext
): Promise<ScrapedProblem> {
  const apiKey = (context.apiKey || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('No Gemini API key configured. Please add your Gemini API key in Settings.');
  }

  const modelName = (context.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const ai = new GoogleGenAI({ apiKey });

  let attempt = 0;
  
  const prompt = `
    Extract the competitive programming problem details from the provided HTML.

    CRITICAL FORMATTING RULES:
    1. DECODE all HTML entities to their actual characters: < → <, > → >, & → &, " → ", &#39; → ', &nbsp; → space, &le; → ≤, &ge; → ≥, etc. NEVER leave raw HTML entities in the output.
    2. Convert HTML formatting/math into standard Markdown and LaTeX ($...$ or $$...$$).
    3. PRESERVE inline highlighting: convert <strong>, <b>, <mark>, <u> tags to **bold** markdown. This is critical for problems that highlight specific substrings — each highlighted region must remain distinguishable.
    4. Do NOT include examples (Input/Output/Explanation) in problemStatementMarkdown — put them ONLY in the examples array. The statement should end before the examples section.
    5. If constraints are mixed in the problem statement, separate them into constraintsMarkdown. Do NOT duplicate constraints in both fields.
    6. Preserve newlines in example input/output fields — do not collapse multi-line inputs to a single line.
    7. Mark isInteractive as true ONLY if the problem involves query-response interaction with a grader.
  `;

  console.log(`[Scraper] Starting AI extraction with model "${modelName}" for ${context.url} (Body Length: ${html.length} chars)`);

  while (attempt <= MAX_RETRIES) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          { role: 'user', parts: [{ text: prompt }, { text: html.substring(0, 500_000) }] }
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "The title of the competitive programming problem" },
              isInteractive: { type: Type.BOOLEAN, description: "Whether the problem is interactive (requires query-response with grader)" },
              problemStatementMarkdown: { type: Type.STRING, description: "The main problem statement converted to Markdown with LaTeX math" },
              constraintsMarkdown: { type: Type.STRING, description: "The constraints section converted to Markdown" },
              editorialMarkdown: { type: Type.STRING, description: "The editorial or tutorial section if present in the HTML" },
              examples: {
                type: Type.ARRAY,
                description: "List of test cases / examples",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    testId: { type: Type.INTEGER, description: "1-indexed test case number" },
                    input: { type: Type.STRING, description: "The raw input string for the test case" },
                    output: { type: Type.STRING, description: "The expected output string for the test case" },
                    explanation: { type: Type.STRING, description: "Explanation of the example if present" }
                  },
                  required: ["testId", "input", "output"]
                }
              }
            },
            required: ["title", "isInteractive", "problemStatementMarkdown", "examples"]
          }
        }
      });
      
      const text = response.text;
      if (!text) {
        throw new Error('Empty response from Gemini');
      }
      
      if (text.length > 500_000) {
        throw new Error("AI response payload exceeds maximum 500KB limit.");
      }

      const cleanedJson = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      const rawAiOutput = JSON.parse(cleanedJson);
      
      // Validate raw AI output first against GeminiExtractionSchema
      const aiData = GeminiExtractionSchema.parse(rawAiOutput);

      // Apply deterministic post-processing to fix LLM formatting issues:
      //   - decode HTML entities
      //   - strip examples from statement (they're in the examples array)
      //   - strip duplicate constraints from statement
      //   - normalize newlines/whitespace
      const cleaned = postProcessExtraction(aiData);

      // Enrich & Map into full ScrapedProblem structure
      const completeProblem = {
        id: context.id || new URL(context.url).pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'unknown-id',
        url: context.url,
        platform: context.platform,
        title: cleaned.title,
        isInteractive: cleaned.isInteractive,
        content: {
          problemStatementMarkdown: cleaned.problemStatementMarkdown,
          constraintsMarkdown: cleaned.constraintsMarkdown,
          editorialMarkdown: cleaned.editorialMarkdown,
        },
        examples: cleaned.examples,
      };
      
      // Run final system validation
      const validated = ScrapedProblemSchema.parse(completeProblem);
      return validated;
      
    } catch (e: any) {
      const rawErrorMsg = e?.message || String(e);
      const sanitizedMsg = sanitizeErrorMessage(rawErrorMsg, apiKey);

      // Check if error is due to an invalid/unsupported model name (404/400)
      const isModelError = 
        e?.status === 404 || 
        e?.status === 400 || 
        /model.*not found/i.test(sanitizedMsg) || 
        /is not supported/i.test(sanitizedMsg) ||
        /publisher.*not found/i.test(sanitizedMsg);

      if (isModelError) {
        throw new Error(`Invalid Gemini model "${modelName}" configured in settings: ${sanitizedMsg}`);
      }

      attempt++;
      if (attempt > MAX_RETRIES) {
        throw new Error(sanitizedMsg);
      }
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  
  throw new Error('Failed to extract problem from HTML');
}
