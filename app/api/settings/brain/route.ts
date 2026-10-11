import { brainEntfernenHandler, brainSpeichernHandler } from '@/lib/brain-routen';
import { mitRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Brain-URL und -Token setzen/entfernen (nur Admin). Die Antworten enthalten nie den Token, nur die Maske („…abcd“).
export const PUT = mitRolle('admin', brainSpeichernHandler());
export const DELETE = mitRolle('admin', brainEntfernenHandler());
