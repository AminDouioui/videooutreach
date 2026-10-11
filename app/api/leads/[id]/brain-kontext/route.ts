import { brainKontextHandler } from '@/lib/brain-routen';
import { mitRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Kontext des Leads aus dem Brain (nur lesend; ohne eingerichtetes Brain {status: 'nicht_konfiguriert'}). */
export const GET = mitRolle('lesen', brainKontextHandler());
