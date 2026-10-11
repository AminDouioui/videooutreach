import { vorlageHandler } from '@/lib/ki-routen';
import { mitRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Optionale KI-Funktion (nur mit ANTHROPIC_API_KEY, sonst 404). */
export const POST = mitRolle('mitglied', vorlageHandler());
