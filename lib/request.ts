import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';

/** Client-IP aus Proxy-Headern (erste x-forwarded-for, sonst x-real-ip) */
export function clientIp(req: NextRequest | Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'unbekannt';
}

export function fehler(meldung: string, status = 400) {
  return NextResponse.json({ error: meldung }, { status });
}

/** JSON-Body mit zod validieren; liefert Daten oder eine fertige Fehlerantwort. */
export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<{ data: T } | { response: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { response: fehler('Ungültiger Request-Body') };
  }
  try {
    return { data: schema.parse(body) };
  } catch (e) {
    if (e instanceof ZodError) return { response: fehler(`Ungültige Eingabe: ${e.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`) };
    throw e;
  }
}
