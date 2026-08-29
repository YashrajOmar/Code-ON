import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const DEMO_USER_EMAIL = 'demo@codeon.dev';

async function getDemoUser() {
  return prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
}

export async function POST(req: Request) {
  try {
    const { platform, handle } = await req.json();

    if (!platform || !handle?.trim()) {
      return NextResponse.json({ success: false, error: 'platform and handle are required' }, { status: 400 });
    }

    const user = await getDemoUser();
    if (!user) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });

    // Save profile to DB
    const profile = await prisma.codingProfile.upsert({
      where: { userId_platform_handle: { userId: user.id, platform, handle: handle.trim() } },
      update: {},
      create: { userId: user.id, platform, handle: handle.trim() },
    });

    // Kick off background scraping (fire-and-forget — doesn't block response)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    fetch(`${baseUrl}/api/settings/profiles/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, handle: handle.trim() }),
    }).catch(() => {});

    return NextResponse.json({ success: true, data: profile, scraping: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }
}
