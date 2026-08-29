import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { embedText, toVectorLiteral } from "@/lib/embeddings";

/**
 * RAG Ingestion Webhook — /api/webhooks/ingest
 *
 * Receives the daily scraped user submissions, generates a
 * text-embedding-004 vector (768-dim) for each topic profile, and UPSERTs it
 * into the `UserTopicProfile` table (keyed by userId + topic).
 *
 * Security:
 *   - Bearer token auth via INGEST_WEBHOOK_SECRET (timing-safe compare).
 *   - Input validated before any embedding/DB work.
 *   - The user must already exist in the users table (no implicit user
 *     creation from an untrusted webhook).
 *
 * Payload (single profile, backwards compatible):
 *   { userId, topic, skillTier, performanceSummary }
 *
 * Payload (daily batch for one user):
 *   { userId, profiles: [{ topic, skillTier, performanceSummary }, ...] }
 */

const MAX_PERFORMANCE_SUMMARY_LEN = 10_000;
const MAX_BATCH_SIZE = 50;
const ALLOWED_SKILL_TIERS = new Set([
  "Beginner",
  "Easy",
  "Medium",
  "Hard",
  "Advanced",
  "Expert",
  "Grandmaster",
]);

interface IngestEntry {
  topic: string;
  skillTier: string;
  performanceSummary: string;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function validateEntry(raw: unknown): IngestEntry | string {
  if (!raw || typeof raw !== "object") return "each profile must be an object";
  const e = raw as Record<string, unknown>;
  if (typeof e.topic !== "string" || !e.topic.trim()) return "topic is required";
  if (typeof e.skillTier !== "string" || !e.skillTier.trim())
    return "skillTier is required";
  if (typeof e.performanceSummary !== "string" || !e.performanceSummary.trim())
    return "performanceSummary is required";
  if (e.performanceSummary.length > MAX_PERFORMANCE_SUMMARY_LEN)
    return "performanceSummary too long";
  if (!ALLOWED_SKILL_TIERS.has(e.skillTier))
    return `skillTier "${e.skillTier}" is not a recognized tier`;
  return {
    topic: e.topic.trim().slice(0, 200),
    skillTier: e.skillTier,
    performanceSummary: e.performanceSummary,
  };
}

export async function POST(req: Request) {
  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  const secret = process.env.INGEST_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Server misconfigured: INGEST_WEBHOOK_SECRET is not set" },
      { status: 500 }
    );
  }
  if (!authHeader || !authHeader.startsWith("Bearer ") || !timingSafeEqualString(authHeader.slice(7), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Parse + validate payload ──────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b.userId !== "string" || !b.userId.trim()) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  const userId = b.userId;

  // Normalize to an entries array (single-profile form → one entry).
  let rawEntries: unknown[];
  if (Array.isArray(b.profiles)) {
    rawEntries = b.profiles;
  } else if (b.topic || b.skillTier || b.performanceSummary) {
    rawEntries = [b];
  } else {
    return NextResponse.json(
      { error: "Provide either a single profile or a 'profiles' array" },
      { status: 400 }
    );
  }

  if (rawEntries.length === 0) {
    return NextResponse.json({ error: "No profiles provided" }, { status: 400 });
  }
  if (rawEntries.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Batch too large (max ${MAX_BATCH_SIZE})` },
      { status: 413 }
    );
  }

  const entries: IngestEntry[] = [];
  for (const raw of rawEntries) {
    const result = validateEntry(raw);
    if (typeof result === "string") {
      return NextResponse.json({ error: result }, { status: 400 });
    }
    entries.push(result);
  }

  // ── 3. Ensure the user exists ─────────────────────────────────────────────
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // ── 4. Embed + upsert each topic profile ───────────────────────────────────
  // Embed sequentially to stay polite to the embedding API; upsert in parallel.
  let ingested = 0;
  try {
    const upserts: Promise<number>[] = [];

    for (const entry of entries) {
      const embeddingText = `Topic: ${entry.topic}. Skill Tier: ${entry.skillTier}. Profile: ${entry.performanceSummary}`;
      const embedding = await embedText(embeddingText);
      const literal = toVectorLiteral(embedding);

      upserts.push(
        prisma.$executeRaw`
          INSERT INTO "UserTopicProfile" (id, "userId", topic, "skillTier", "performanceSummary", embedding, "updatedAt")
          VALUES (
            gen_random_uuid()::text,
            ${userId},
            ${entry.topic},
            ${entry.skillTier},
            ${entry.performanceSummary},
            ${literal}::vector,
            NOW()
          )
          ON CONFLICT ("userId", topic)
          DO UPDATE SET
            "skillTier" = EXCLUDED."skillTier",
            "performanceSummary" = EXCLUDED."performanceSummary",
            embedding = EXCLUDED.embedding,
            "updatedAt" = NOW()
        `
      );
    }

    const results = await Promise.all(upserts);
    ingested = results.reduce((sum, n) => sum + n, 0);
  } catch (error: unknown) {
    console.error("Ingestion webhook error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal Server Error", details: message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    ingested,
    message: `${entries.length} profile(s) ingested successfully.`,
  });
}
