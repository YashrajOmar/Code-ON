import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const mod = await import('@codeon/scrapers');
    return NextResponse.json({ ok: true, exports: Object.keys(mod).slice(0, 10) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message, stack: e?.stack?.substring(0, 500) }, { status: 500 });
  }
}
