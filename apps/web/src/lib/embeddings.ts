/**
 * Shared embedding client for the RAG pipeline.
 *
 * Supports three embedding backends (tried in order):
 *   1. Google text-embedding-004 (768-dim) — if GEMINI_API_KEY is set
 *   2. OpenAI-compatible /embeddings endpoint — if a custom provider is configured
 *   3. Deterministic hash-based fallback (768-dim) — always available, no API needed
 *
 * The hash fallback is NOT semantically accurate but ensures the pipeline
 * never dead-ends. Topics with shared keywords will have partially similar vectors.
 */

import { GoogleGenAI } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { decryptKey } from "@/lib/crypto";
import { getAuthUser } from "@/lib/auth";

/** Target dimension — matches the UserTopicProfile.embedding column. */
export const EMBEDDING_DIM = 768;

let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return aiClient;
}

/**
 * Get the custom provider's embedding endpoint config from the DB.
 */
async function getCustomEmbeddingConfig(): Promise<{ baseUrl: string; apiKey: string; model: string } | null> {
  try {
    const authUser = await getAuthUser();
    if (!authUser) return null;
    const user = await prisma.user.findUnique({
      where: { id: authUser.userId },
      include: { apiKeys: true },
    });
    if (!user) return null;

    const keys = user.apiKeys as Array<{ provider: string; encryptedKey: string }>;

    // Find the first custom provider with a key
    const customEntry = keys.find((k) => k.provider.startsWith("custom_") && !k.provider.includes("_model") && !k.provider.includes("_baseurl"));
    if (!customEntry) return null;

    const decrypted = decryptKey(customEntry.encryptedKey);
    if (!decrypted) return null;

    const config = JSON.parse(decrypted) as { key: string; baseUrl: string; model: string };
    if (!config.key) return null;

    return {
      baseUrl: config.baseUrl || "https://api.openai.com/v1",
      apiKey: config.key,
      model: "text-embedding-3-small", // Default — most OpenAI-compatible APIs support this
    };
  } catch {
    return null;
  }
}

/**
 * Try embedding via OpenAI-compatible /embeddings endpoint.
 */
async function embedViaOpenAICompatible(text: string, config: { baseUrl: string; apiKey: string; model: string }): Promise<number[]> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, input: text }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);

  const data = await res.json();
  const embedding: number[] = data?.data?.[0]?.embedding;
  if (!embedding || embedding.length === 0) throw new Error("No embedding in response");

  // Pad or truncate to EMBEDDING_DIM
  if (embedding.length < EMBEDDING_DIM) {
    return [...embedding, ...new Array(EMBEDDING_DIM - embedding.length).fill(0)];
  }
  if (embedding.length > EMBEDDING_DIM) {
    return embedding.slice(0, EMBEDDING_DIM);
  }
  return embedding;
}

/**
 * Deterministic hash-based pseudo-embedding (fallback when no API is available).
 * NOT semantically accurate, but produces consistent vectors and allows
 * the RAG pipeline to function end-to-end.
 */
function hashEmbedding(text: string): number[] {
  const vec = new Array(EMBEDDING_DIM).fill(0);
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);

  for (const word of words) {
    // Hash each word to multiple positions in the vector
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    // Distribute across 3 positions for better differentiation
    for (let j = 0; j < 3; j++) {
      const pos = Math.abs(hash + j * 257) % EMBEDDING_DIM;
      vec[pos] += (hash % 100) / 100;
    }
  }

  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Embed a single text string into a EMBEDDING_DIM vector.
 * Tries Gemini → OpenAI-compatible → hash fallback.
 */
export async function embedText(text: string): Promise<number[]> {
  // Strategy 1: Google Gemini (if key is set)
  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = getGeminiClient();
      const response = await ai.models.embedContent({
        model: "text-embedding-004",
        contents: text,
      });
      const values = response.embeddings?.[0]?.values;
      if (values && values.length === EMBEDDING_DIM) return values;
    } catch {
      // Fall through to next strategy
    }
  }

  // Strategy 2: OpenAI-compatible endpoint (user's custom provider)
  try {
    const config = await getCustomEmbeddingConfig();
    if (config) {
      return await embedViaOpenAICompatible(text, config);
    }
  } catch {
    // Fall through to hash fallback
  }

  // Strategy 3: Hash-based fallback (always works)
  return hashEmbedding(text);
}

/**
 * Format an embedding as a pgvector text literal (`[v1,v2,...]`).
 */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
