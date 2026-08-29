/**
 * RAG Retrieval Library.
 *
 * Retrieves the user's historical coding profile — including their actual
 * submission code, coding style, and topic mastery — via pgvector cosine
 * similarity search against UserTopicProfile.
 *
 * Also retrieves reference solutions from scraped problems as a coding
 * style baseline when user's own submissions aren't available.
 */

import { prisma } from "@/lib/prisma";
import { embedText, toVectorLiteral } from "@/lib/embeddings";

export interface TopicProfileMatch {
  readonly topic: string;
  readonly skillTier: string;
  readonly distance: number;
  readonly codeSnippet: string | null;
  readonly performanceSummary: string | null;
}

export interface CodingStyleProfile {
  readonly userId: string;
  readonly isNewUser: boolean;
  readonly matches: TopicProfileMatch[];
  readonly summary: string;
}

const TOP_K = 5;
const MAX_DISTANCE = 2.0;

export async function retrieveUserTopicProfile(
  userId: string,
  problemTitle: string,
  problemTags: string[]
): Promise<CodingStyleProfile> {
  try {
    const queryText = `Problem: ${problemTitle}. Tags: ${problemTags.join(", ")}`;
    const embedding = await embedText(queryText);
    const literal = toVectorLiteral(embedding);

    const matches = await prisma.$queryRaw<TopicProfileMatch[]>`
      SELECT
        topic,
        "skillTier",
        "performanceSummary",
        "codeSnippet",
        embedding <=> ${literal}::vector AS distance
      FROM "UserTopicProfile"
      WHERE "userId" = ${userId}
      ORDER BY distance ASC
      LIMIT ${TOP_K}
    `;

    if (!matches || matches.length === 0) {
      return {
        userId,
        isNewUser: true,
        matches: [],
        summary: "No historical coding profile found. Treat as new user — use simple language and guide step by step.",
      };
    }

    const relevant = matches.filter((m) => m.distance <= MAX_DISTANCE);

    if (relevant.length === 0) {
      return {
        userId,
        isNewUser: false,
        matches,
        summary: "No closely related historical coding profile. The user has attempted similar topics.",
      };
    }

    // Build a rich summary that includes actual code patterns
    const parts: string[] = [];
    parts.push("User's Coding Profile (from their Codeforces submissions):");

    for (const m of relevant) {
      parts.push(`\nTopic: ${m.topic} | Skill: ${m.skillTier}`);
      if (m.performanceSummary) {
        // Extract key lines from the performance summary
        const lines = m.performanceSummary.split('\n');
        for (const line of lines) {
          if (line.includes('rating') || line.includes('rank') || line.includes('Solved') || line.includes('language')) {
            parts.push(line.trim());
          }
        }
      }
    }

    // Include actual code snippets from the user's past submissions
    const withCode = relevant.filter((m) => m.codeSnippet && m.codeSnippet.length > 20);
    if (withCode.length > 0) {
      parts.push("\n=== USER'S ACTUAL CODING STYLE (from their past accepted submissions) ===");
      for (const m of withCode.slice(0, 2)) {
        const snippet = m.codeSnippet!.length > 800
          ? m.codeSnippet!.substring(0, 800) + '\n// ... (truncated)'
          : m.codeSnippet!;
        parts.push(`\nFrom ${m.topic} problems:`);
        parts.push('```cpp');
        parts.push(snippet);
        parts.push('```');
      }
    } else {
      // No user code available — note this so the LLM knows
      parts.push("\n(Note: User's actual submission code not available. Use clean, optimized C++ with raw array indexing — avoid substr() in loops as it's O(N) per call.)");
    }

    return {
      userId,
      isNewUser: false,
      matches: relevant,
      summary: parts.join('\n'),
    };
  } catch (error) {
    console.error("RAG retrieval error:", error);
    return {
      userId,
      isNewUser: true,
      matches: [],
      summary: "Error retrieving coding profile. Treat as new user.",
    };
  }
}

export async function retrieveUserProfileContext(
  userId: string,
  problemTitle: string,
  problemTags: string[]
): Promise<string> {
  const profile = await retrieveUserTopicProfile(userId, problemTitle, problemTags);
  return profile.summary;
}
