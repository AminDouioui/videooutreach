import { threadHandler } from '@/lib/antworten';
import { mitRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Verlauf (Text, bereinigt) eines Threads des Leads – braucht den Lesezugriff des Postfachs. */
export const GET = mitRolle('lesen', threadHandler());
