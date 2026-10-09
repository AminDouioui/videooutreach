import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fehler, parseJson } from '@/lib/request';
import { addSuppression, listSuppression, removeSuppression } from '@/lib/suppression';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// E-Mail-Adresse oder ganze Domain ('@firma.de')
const DOMAIN_REGEX = /^@(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const emailSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320)
    .refine((s) => (s.startsWith('@') ? DOMAIN_REGEX.test(s) : z.string().email().safeParse(s).success), 'Ungültige E-Mail-Adresse oder Domain (z. B. @firma.de)'),
});
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
