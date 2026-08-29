import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptKey, decryptKey } from '@/lib/crypto';
import {
  getProviderStatuses,
  saveCustomProvider,
  deleteCustomProvider,
  type ApiFormat,
} from '@/lib/ai-providers';
import { getAuthUser, unauthorized } from '@/lib/auth';
import { rateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit';

export async function GET() {
  try {
    const authUser = await getAuthUser();
    if (!authUser) return unauthorized();

    const rl = rateLimit(`settings:${authUser.userId}`, RATE_LIMITS.settings);
    if (!rl.allowed) return tooManyRequests(rl.resetAt);

    const user = await prisma.user.findUnique({
      where: { id: authUser.userId },
      include: { codingProfiles: true },
    });

    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const { builtinStatus, customProviders, geminiModel } = await getProviderStatuses();

    return NextResponse.json({
      success: true,
      data: {
        apiKeyStatus: builtinStatus,
        customProviders,
        geminiModel,
        codingProfiles: (user.codingProfiles as any[]).map((p) => ({
          id: p.id,
          platform: p.platform,
          handle: p.handle,
        })),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const authUser = await getAuthUser();
    if (!authUser) return unauthorized();

    const rl = rateLimit(`settings:${authUser.userId}`, RATE_LIMITS.settings);
    if (!rl.allowed) return tooManyRequests(rl.resetAt);

    const body = await req.json();
    const { apiKeys, geminiModel, clearKeys, customProviders, removedCustomIds } = body;

    const user = await prisma.user.findUnique({ where: { id: authUser.userId } });
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // ── Built-in provider keys ──────────────────────────────────────────
    if (apiKeys && typeof apiKeys === 'object') {
      for (const [provider, rawKey] of Object.entries(apiKeys)) {
        if (provider === 'gemini_model' || provider.startsWith('custom_')) continue;
        const key = (rawKey as string)?.trim() || '';
        if (key === '') continue;
        const encrypted = encryptKey(key);
        await prisma.apiKey.upsert({
          where: { userId_provider: { userId: user.id, provider } },
          update: { encryptedKey: encrypted },
          create: { userId: user.id, provider, encryptedKey: encrypted },
        });
      }
    }

    // ── Clear built-in keys (explicit deletion) ──────────────────────────
    if (Array.isArray(clearKeys)) {
      for (const provider of clearKeys) {
        if (typeof provider === 'string' && !provider.startsWith('custom_') && provider !== 'gemini_model') {
          await prisma.apiKey.deleteMany({ where: { userId: user.id, provider } });
        }
      }
    }

    // ── Gemini model ─────────────────────────────────────────────────────
    if (geminiModel !== undefined) {
      const model = typeof geminiModel === 'string' ? geminiModel.trim() : 'gemini-2.5-flash';
      const encrypted = encryptKey(model || 'gemini-2.5-flash');
      await prisma.apiKey.upsert({
        where: { userId_provider: { userId: user.id, provider: 'gemini_model' } },
        update: { encryptedKey: encrypted },
        create: { userId: user.id, provider: 'gemini_model', encryptedKey: encrypted },
      });
    }

    // ── Custom providers (dynamic + button) ──────────────────────────────
    if (Array.isArray(customProviders)) {
      for (const cp of customProviders) {
        if (!cp || typeof cp !== 'object') continue;
        const { id, key, label, baseUrl, model, format } = cp as {
          id: string; key: string; label: string; baseUrl: string; model: string; format: ApiFormat;
        };
        if (!id || !key?.trim()) continue;
        await saveCustomProvider(id, {
          key: key.trim(),
          label: (label || 'Custom').trim(),
          baseUrl: (baseUrl || 'https://api.openai.com/v1').trim(),
          model: (model || 'gpt-4o').trim(),
          format: format || 'openai',
        });
      }
    }

    // ── Remove deleted custom providers ──────────────────────────────────
    if (Array.isArray(removedCustomIds)) {
      for (const id of removedCustomIds) {
        if (typeof id === 'string' && id.startsWith('custom_')) {
          await deleteCustomProvider(id);
        }
      }
    }

    return NextResponse.json({ success: true, message: 'Settings saved successfully' });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to save settings' },
      { status: 500 }
    );
  }
}
