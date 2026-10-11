import { entwurfHandler } from '@/lib/ki-routen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Optionale KI-Funktion (nur mit ANTHROPIC_API_KEY, sonst 404). */
export const POST = entwurfHandler();
