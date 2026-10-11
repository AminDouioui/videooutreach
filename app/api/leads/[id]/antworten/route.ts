import { antwortHandler } from '@/lib/antworten';
import { mitRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Antwort aus der Unibox senden: {text, threadId?} → Mail im Thread über das Postfach des Leads. */
export const POST = mitRolle('mitglied', antwortHandler());
