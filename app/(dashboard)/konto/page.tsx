import { KontoFormular } from '@/components/KontoFormular';
import { erforderSeitenRolle } from '@/lib/seiten-zugriff';
import { ROLLEN_NAME } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function KontoPage() {
  const me = await erforderSeitenRolle();
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-semibold">Mein Konto</h1>
      <p className="text-sm text-slate-600">
        Angemeldet als <strong>{me.name}</strong>
        {me.email && <> ({me.email})</>} · Rolle: {ROLLEN_NAME[me.rolle]}
      </p>
      {me.envAdmin ? (
        <p className="rounded-md bg-slate-100 p-3 text-sm text-slate-600">
          Sie sind über das Admin-Passwort der Server-Konfiguration (<code>ADMIN_PASSWORD</code>) angemeldet. Dieses Passwort ändern Sie in der Konfiguration des Servers, nicht hier.
        </p>
      ) : (
        <KontoFormular name={me.name} />
      )}
    </div>
  );
}
