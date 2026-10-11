import { brainTestHandler } from '@/lib/brain-routen';
import { mitRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** „Verbindung testen“ (nur Admin): GET /api/extern/health im Brain. Die Antwort enthält nur die Meldung. */
export const POST = mitRolle('admin', brainTestHandler());
