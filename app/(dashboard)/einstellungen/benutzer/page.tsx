import Link from 'next/link';
import { BenutzerVerwaltung } from '@/components/BenutzerVerwaltung';
import { listeBenutzer, listeEinladungen } from '@/lib/benutzer';
import { erforderSeitenRolle } from '@/lib/seiten-zugriff';

export const dynamic = 'force-dynamic';

export default async function BenutzerPage() {
  const me = await erforderSeitenRolle('admin');
  const benutzer = listeBenutzer().map((b) => ({
    id: b.id,
    email: b.email,
    name: b.name,
    rolle: b.rolle,
    aktiv: b.aktiv,
    letzterLoginAt: b.letzterLoginAt ? b.letzterLoginAt.toISOString() : null,
    createdAt: b.createdAt.toISOString(),
  }));
  const einladungen = listeEinladungen().map((e) => ({ id: e.id, email: e.email, rolle: e.rolle, ablaufAt: e.ablaufAt.toISOString(), abgelaufen: e.abgelaufen, createdAt: e.createdAt.toISOString() }));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/einstellungen" className="text-xs text-slate-500 hover:underline">
          ← Einstellungen
        </Link>
        <h1 className="text-xl font-semibold">Benutzer</h1>
        <p className="mt-1 text-sm text-slate-600">
          Admin: alles. Mitglied: Kampagnen, Leads, Antworten und Versand – aber keine Postfächer, globalen Einstellungen, Integrationen, Benutzer und kein Löschen von Kampagnen. Nur lesen: ansehen und CSV exportieren.
          Der Zugang über <code>ADMIN_PASSWORD</code> bleibt immer bestehen und steht nicht in dieser Liste.
        </p>
      </div>
      <BenutzerVerwaltung benutzer={benutzer} einladungen={einladungen} meineId={me.id} />
    </div>
  );
}
