import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthUser, unauthorized } from '@/lib/auth';
import { rateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit';

/**
 * POST /api/settings/reset-rag
 * Wipes all UserTopicProfile rows for the authenticated user.
 * Forces a clean RAG slate — user must re-sync via companion app.
 */
export async function POST() {
  try {
    const authUser = await getAuthUser();
    if (!authUser) return unauthorized();

    const rl = rateLimit(`reset:${authUser.userId}`, RATE_LIMITS.settings);
    if (!rl.allowed) return tooManyRequests(rl.resetAt);

    // Delete all RAG profiles for this user
    const deleted = await prisma.$executeRaw`
      DELETE FROM "UserTopicProfile" WHERE "userId" = ${authUser.userId}
    `;

    return NextResponse.json({
      success: true,
      message: `RAG data wiped. ${deleted} rows deleted. Re-sync via companion app to rebuild.`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to reset RAG data' },
      { status: 500 }
    );
  }
}
