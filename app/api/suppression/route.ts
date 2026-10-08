import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fehler, parseJson } from '@/lib/request';
import { addSuppression, listSuppression, removeSuppression } from '@/lib/suppression';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email('Ungültige E-Mail-Adresse').max(320) });
const addSchema = emailSchema.extend({ reason: z.string().trim().max(200).optional() });

export async function GET() {
  return NextResponse.json(listSuppression());
}

export async function POST(req: Request) {
  const parsed = await parseJson(req, addSchema);
  if ('response' in parsed) return parsed.response;
  addSuppression(parsed.data.email, parsed.data.reason || 'manuell');
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const parsed = await parseJson(req, emailSchema);
  if ('response' in parsed) return parsed.response;
  if (!parsed.data.email) return fehler('E-Mail fehlt');
  removeSuppression(parsed.data.email);
  return NextResponse.json({ ok: true });
}
