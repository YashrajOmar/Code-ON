import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptKey, decryptKey } from '@/lib/crypto';
import { getAuthUser, unauthorized } from '@/lib/auth';
import crypto from 'crypto';

/**
 * POST /api/settings/companion-token
 * Generates or retrieves the user's companion app token.
 * This token is used by the companion desktop app to authenticate uploads.
 */
export async function POST() {
  try {
    const authUser = await getAuthUser();
    if (!authUser) return unauthorized();

    // Check if token already exists
    const existing = await prisma.apiKey.findUnique({
      where: {
        userId_provider: { userId: authUser.userId, provider: 'companion_token' },
      },
    });

    if (existing) {
      const token = decryptKey(existing.encryptedKey);
      if (token) {
        return NextResponse.json({ success: true, token });
      }
    }

    // Generate new token
    const token = `cot_${crypto.randomBytes(24).toString('hex')}`;
    const encrypted = encryptKey(token);

    await prisma.apiKey.upsert({
      where: { userId_provider: { userId: authUser.userId, provider: 'companion_token' } },
      update: { encryptedKey: encrypted },
      create: { userId: authUser.userId, provider: 'companion_token', encryptedKey: encrypted },
    });

    return NextResponse.json({ success: true, token });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to generate token' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const authUser = await getAuthUser();
    if (!authUser) return unauthorized();

    const existing = await prisma.apiKey.findUnique({
      where: {
        userId_provider: { userId: authUser.userId, provider: 'companion_token' },
      },
    });

    if (existing) {
      const token = decryptKey(existing.encryptedKey);
      if (token) {
        return NextResponse.json({ success: true, token, hasToken: true });
      }
    }

    return NextResponse.json({ success: true, hasToken: false });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch token' },
      { status: 500 }
    );
  }
}
