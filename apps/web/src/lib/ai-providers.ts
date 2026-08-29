/**
 * Shared AI Provider routing.
 *
 * Centralizes all LLM API calls so every route (/api/hint, /api/ai/hint, etc.)
 * uses the same provider resolution and streaming logic.
 *
 * Three API formats are supported:
 *   1. "gemini"     — Google GenAI SDK (generateContentStream)
 *   2. "openai"     — OpenAI-compatible REST (/chat/completions SSE stream)
 *                     Used by OpenAI, GLM, DeepSeek, Mistral, Ollama, etc.
 *   3. "anthropic"  — Anthropic Messages API (/messages SSE stream)
 *
 * Provider resolution order: gemini → openai → anthropic → custom_1 → custom_2 → ...
 */

import { GoogleGenAI } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { encryptKey, decryptKey } from "@/lib/crypto";
import { getAuthUser } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ApiFormat = "gemini" | "openai" | "anthropic";

export interface ProviderConfig {
  /** Unique ID: "gemini" | "openai" | "anthropic" | "custom_<id>" */
  id: string;
  /** Display label, e.g. "GLM", "DeepSeek", "My Local LLM" */
  label: string;
  /** The API format — determines how we call the endpoint */
  format: ApiFormat;
  /** Decrypted API key (never sent to client) */
  apiKey: string;
  /** Base URL for REST-based providers (openai/anthropic). null for gemini SDK */
  baseUrl: string | null;
  /** Model name, e.g. "gemini-2.5-flash", "glm-4-flash", "gpt-4o" */
  model: string;
}

export interface ProviderStatus {
  id: string;
  label: string;
  format: ApiFormat;
  hasKey: boolean;
  baseUrl: string | null;
  model: string;
}

// ── Built-in provider defaults ────────────────────────────────────────────────

const BUILTIN_PROVIDERS = [
  {
    id: "gemini",
    label: "Google Gemini",
    format: "gemini" as ApiFormat,
    defaultModel: "gemini-2.5-flash",
    defaultBaseUrl: null as string | null,
  },
  {
    id: "openai",
    label: "OpenAI",
    format: "openai" as ApiFormat,
    defaultModel: "gpt-4o",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    format: "anthropic" as ApiFormat,
    defaultModel: "claude-sonnet-4-20250514",
    defaultBaseUrl: "https://api.anthropic.com",
  },
];

// ── Load all providers from DB ────────────────────────────────────────────────

/**
 * Load and decrypt all configured providers from the database.
 * Returns providers in priority order: built-ins first, then customs.
 * Uses getAuthUser() to find the current user's API keys.
 */
export async function loadProviders(): Promise<ProviderConfig[]> {
  try {
    const authUser = await getAuthUser();
    if (!authUser) return [];

    const user = await prisma.user.findUnique({
      where: { id: authUser.userId },
      include: { apiKeys: true },
    });
    if (!user) return [];

    const keys = user.apiKeys as Array<{
      provider: string;
      encryptedKey: string;
    }>;

    const providers: ProviderConfig[] = [];

    // Built-in providers
    for (const builtin of BUILTIN_PROVIDERS) {
      const keyEntry = keys.find((k) => k.provider === builtin.id);
      if (!keyEntry) continue;

      const decrypted = decryptKey(keyEntry.encryptedKey);
      if (!decrypted) continue;

      // Gemini model is stored separately
      let model = builtin.defaultModel;
      if (builtin.id === "gemini") {
        const modelEntry = keys.find((k) => k.provider === "gemini_model");
        if (modelEntry) {
          const decModel = decryptKey(modelEntry.encryptedKey);
          if (decModel && decModel.trim()) model = decModel.trim();
        }
      }

      providers.push({
        id: builtin.id,
        label: builtin.label,
        format: builtin.format,
        apiKey: decrypted,
        baseUrl: builtin.defaultBaseUrl,
        model,
      });
    }

    // Custom providers — stored as custom_<id> with JSON config in encryptedKey
    const customEntries = keys.filter((k) => k.provider.startsWith("custom_") && !k.provider.includes("_model") && !k.provider.includes("_baseurl"));
    for (const entry of customEntries) {
      const decrypted = decryptKey(entry.encryptedKey);
      if (!decrypted) continue;

      try {
        const config = JSON.parse(decrypted) as {
          key: string;
          label: string;
          baseUrl: string;
          model: string;
          format: ApiFormat;
        };
        if (!config.key) continue;

        providers.push({
          id: entry.provider,
          label: config.label || "Custom",
          format: config.format || "openai",
          apiKey: config.key,
          baseUrl: config.baseUrl || "https://api.openai.com/v1",
          model: config.model || "gpt-4o",
        });
      } catch {
        // Not valid JSON — skip
      }
    }

    return providers;
  } catch {
    return [];
  }
}

/**
 * Get the first available provider (priority order).
 */
export async function getActiveProvider(): Promise<ProviderConfig | null> {
  const providers = await loadProviders();
  return providers[0] ?? null;
}

/**
 * Get provider statuses for the settings UI (no secrets exposed).
 */
export async function getProviderStatuses(): Promise<{
  builtinStatus: Record<string, boolean>;
  customProviders: ProviderStatus[];
  geminiModel: string;
}> {
  const providers = await loadProviders();

  const builtinStatus: Record<string, boolean> = {};
  let geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  for (const p of providers) {
    if (p.id === "gemini" || p.id === "openai" || p.id === "anthropic") {
      builtinStatus[p.id] = true;
      if (p.id === "gemini") geminiModel = p.model;
    }
  }

  const customProviders: ProviderStatus[] = providers
    .filter((p) => p.id.startsWith("custom_"))
    .map((p) => ({
      id: p.id,
      label: p.label,
      format: p.format,
      hasKey: true,
      baseUrl: p.baseUrl,
      model: p.model,
    }));

  return { builtinStatus, customProviders, geminiModel };
}

// ── Save custom provider ─────────────────────────────────────────────────────

export async function saveCustomProvider(
  providerId: string,
  config: { key: string; label: string; baseUrl: string; model: string; format: ApiFormat }
): Promise<void> {
  const authUser = await getAuthUser();
  if (!authUser) throw new Error("User not authenticated");

  const json = JSON.stringify(config);
  const encrypted = encryptKey(json);

  await prisma.apiKey.upsert({
    where: { userId_provider: { userId: authUser.userId, provider: providerId } },
    update: { encryptedKey: encrypted },
    create: { userId: authUser.userId, provider: providerId, encryptedKey: encrypted },
  });
}

export async function deleteCustomProvider(providerId: string): Promise<void> {
  const authUser = await getAuthUser();
  if (!authUser) return;
  await prisma.apiKey.deleteMany({ where: { userId: authUser.userId, provider: providerId } });
}

// ── Streaming ─────────────────────────────────────────────────────────────────

/** A single message in the conversation history. */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Stream a completion from any provider. Returns a ReadableStream of text.
 * Routes to the correct API based on provider.format.
 * Accepts full conversation history for stateless APIs.
 */
export async function streamCompletion(
  provider: ProviderConfig,
  prompt: string,
  options?: { temperature?: number; maxTokens?: number; messages?: ChatMessage[] }
): Promise<ReadableStream<Uint8Array>> {
  const temperature = options?.temperature ?? 0.3;
  const maxTokens = options?.maxTokens ?? 512;
  const encoder = new TextEncoder();
  const messages = options?.messages;

  if (provider.format === "gemini") {
    return streamGemini(provider, prompt, messages, temperature, maxTokens, encoder);
  }
  if (provider.format === "anthropic") {
    return streamAnthropic(provider, prompt, messages, temperature, maxTokens, encoder);
  }
  // Default: OpenAI-compatible
  return streamOpenAICompatible(provider, prompt, messages, temperature, maxTokens, encoder);
}

// ── Gemini (SDK) ──────────────────────────────────────────────────────────────

async function streamGemini(
  provider: ProviderConfig,
  prompt: string,
  messages: ChatMessage[] | undefined,
  temperature: number,
  maxTokens: number,
  encoder: TextEncoder
): Promise<ReadableStream<Uint8Array>> {
  const ai = new GoogleGenAI({ apiKey: provider.apiKey });

  // Build contents from conversation history (if provided)
  let contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  if (messages && messages.length > 0) {
    contents = messages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));
  } else {
    contents = [{ role: "user", parts: [{ text: prompt }] }];
  }

  const responseStream = await ai.models.generateContentStream({
    model: provider.model,
    contents,
    config: { temperature, maxOutputTokens: maxTokens },
  });

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of responseStream) {
          const text = chunk.text;
          if (text) controller.enqueue(encoder.encode(text));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

// ── OpenAI-compatible (REST + SSE) ───────────────────────────────────────────

async function streamOpenAICompatible(
  provider: ProviderConfig,
  prompt: string,
  messages: ChatMessage[] | undefined,
  temperature: number,
  maxTokens: number,
  encoder: TextEncoder
): Promise<ReadableStream<Uint8Array>> {
  const baseUrl = provider.baseUrl || "https://api.openai.com/v1";
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  // Build messages array from conversation history (if provided)
  const apiMessages = messages && messages.length > 0
    ? messages
    : [{ role: "user", content: prompt }];

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: apiMessages,
      stream: true,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`API error (${response.status}): ${errText.substring(0, 300)}`);
  }

  return new ReadableStream({
    async start(controller) {
      try {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response stream");
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (!trimmed.startsWith("data: ")) {
              // Log non-SSE lines (might be error messages)
              console.warn("[AI Stream] Non-SSE line:", trimmed.substring(0, 200));
              continue;
            }
            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              // Check for error in response
              if (parsed.error) {
                const errMsg = parsed.error.message || JSON.stringify(parsed.error);
                console.error("[AI Stream] API error in stream:", errMsg);
                controller.enqueue(encoder.encode(`[Error from AI: ${errMsg}]`));
                controller.close();
                return;
              }
              const delta = parsed.choices?.[0]?.delta?.content;
              const reasoningDelta = parsed.choices?.[0]?.delta?.reasoning_content;
              if (delta) {
                controller.enqueue(encoder.encode(delta));
              } else if (reasoningDelta) {
                // GLM-5.2 / DeepSeek-R1 reasoning models stream internal reasoning
                // in reasoning_content and actual response in content.
                // Don't stream reasoning to the user — just track it.
                // The actual content will come after reasoning finishes.
              }
            } catch {
              console.warn("[AI Stream] Unparseable SSE data:", data.substring(0, 200));
            }
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

// ── Anthropic (REST + SSE) ────────────────────────────────────────────────────

async function streamAnthropic(
  provider: ProviderConfig,
  prompt: string,
  messages: ChatMessage[] | undefined,
  temperature: number,
  maxTokens: number,
  encoder: TextEncoder
): Promise<ReadableStream<Uint8Array>> {
  const baseUrl = provider.baseUrl || "https://api.anthropic.com";
  const url = `${baseUrl.replace(/\/$/, "")}/v1/messages`;

  const apiMessages = messages && messages.length > 0
    ? messages.map((m) => ({ role: m.role, content: m.content }))
    : [{ role: "user", content: prompt }];

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: provider.model,
      messages: apiMessages,
      stream: true,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`API error (${response.status}): ${errText.substring(0, 300)}`);
  }

  return new ReadableStream({
    async start(controller) {
      try {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response stream");
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);

            try {
              const parsed = JSON.parse(data);
              // Anthropic SSE: content_block_delta events carry the text
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                controller.enqueue(encoder.encode(parsed.delta.text));
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
