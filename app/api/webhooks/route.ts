import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fehler, parseJson } from '@/lib/request';
import { pruefeWebhookZiel } from '@/lib/webhook-logik';
import { legeWebhookAn, webhookGeheimnis } from '@/lib/webhooks';
import { WEBHOOK_EREIGNISSE } from '@/db/schema';

export const runtime = 'nodejs';

const webhookBodySchema = z.object({
  url: z.string().trim().min(1).max(2000),
  ereignisse: z.array(z.enum(WEBHOOK_EREIGNISSE)).min(1, 'Mindestens ein Ereignis wählen'),
});

/** Webhook anlegen; die Antwort enthält das Geheimnis (danach über „Geheimnis anzeigen“ abrufbar). */
export async function POST(req: Request) {
  const parsed = await parseJson(req, webhookBodySchema);
  if ('response' in parsed) return parsed.response;
  const ziel = await pruefeWebhookZiel(parsed.data.url);
  if (!ziel.ok) return fehler(ziel.grund);
  const hook = legeWebhookAn(parsed.data.url, parsed.data.ereignisse);
  return NextResponse.json({ id: hook.id, geheimnis: webhookGeheimnis(hook) });
}
