import { NextResponse } from 'next/server';
import { disconnectGmail } from '@/lib/gmail';

export const runtime = 'nodejs';

export async function POST() {
  await disconnectGmail();
  return NextResponse.json({ ok: true });
}
