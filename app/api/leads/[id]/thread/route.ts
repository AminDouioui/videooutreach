import { threadHandler } from '@/lib/antworten';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Verlauf (Text, bereinigt) eines Threads des Leads – braucht den Lesezugriff des Postfachs. */
export const GET = threadHandler();
