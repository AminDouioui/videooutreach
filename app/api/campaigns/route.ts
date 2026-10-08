import { NextResponse } from 'next/server';
import { z } from 'zod';
import { STANDARD_BETREFF, STANDARD_TEXT } from '@/lib/campaigns';
import { getDb, schema } from '@/lib/db';
import { parseJson } from '@/lib/request';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(200),
  ctaUrl: z.string().trim().url('Termin-Link muss eine gültige URL sein').max(1000),
});

export async function GET() {
  return NextResponse.json(getDb().select().from(schema.campaigns).all());
}

export async function POST(req: Request) {
  const parsed = await parseJson(req, createSchema);
  if ('response' in parsed) return parsed.response;
  const [kampagne] = getDb()
    .insert(schema.campaigns)
    .values({
      name: parsed.data.name,
      ctaUrl: parsed.data.ctaUrl,
      emailSubjectTemplate: STANDARD_BETREFF,
      emailBodyTemplate: STANDARD_TEXT,
    })
    .returning()
    .all();
  return NextResponse.json(kampagne, { status: 201 });
}
