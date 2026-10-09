import { NextResponse } from 'next/server';
import { z } from 'zod';
import { STANDARD_BETREFF, STANDARD_BETREFF_OHNE_VIDEO, STANDARD_TEXT, STANDARD_TEXT_OHNE_VIDEO } from '@/lib/campaigns';
import { getDb, schema } from '@/lib/db';
import { parseJson } from '@/lib/request';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(200),
  ctaUrl: z.string().trim().url('Termin-Link muss eine gültige URL sein').max(1000),
  mitVideo: z.boolean().default(true),
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
      mitVideo: parsed.data.mitVideo,
      emailSubjectTemplate: parsed.data.mitVideo ? STANDARD_BETREFF : STANDARD_BETREFF_OHNE_VIDEO,
      emailBodyTemplate: parsed.data.mitVideo ? STANDARD_TEXT : STANDARD_TEXT_OHNE_VIDEO,
    })
    .returning()
    .all();
  return NextResponse.json(kampagne, { status: 201 });
}
