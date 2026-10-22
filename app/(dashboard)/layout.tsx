import Link from 'next/link';
import { LogoutButton } from '@/components/LogoutButton';
import { zaehleUngeleseneAntworten } from '@/lib/lead-status-db';
import { erforderSeitenRolle } from '@/lib/seiten-zugriff';
import { ROLLEN_NAME } from '@/lib/session';

// Der Zähler ungelesener Antworten muss bei jedem Aufruf frisch sein
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Ungültige oder entwertete Session (Benutzer deaktiviert/gelöscht, Rolle geändert) → zurück zum Login
  const me = await erforderSeitenRolle();
  const ungelesen = zaehleUngeleseneAntworten();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm font-medium">
          <span className="font-semibold text-indigo-600">Video-Outreach</span>
          <Link href="/" className="text-slate-600 hover:text-slate-900">
            Kampagnen
          </Link>
          <Link href="/antworten" className="text-slate-600 hover:text-slate-900">
            Antworten
            {ungelesen > 0 && (
              <span className="ml-1.5 rounded-full bg-indigo-600 px-1.5 py-0.5 text-xs font-semibold text-white" title={`${ungelesen} ungelesene Antwort${ungelesen === 1 ? '' : 'en'}`}>
                {ungelesen}
              </span>
            )}
          </Link>
          <Link href="/pipeline" className="text-slate-600 hover:text-slate-900">
            Pipeline
          </Link>
          <Link href="/leads" className="text-slate-600 hover:text-slate-900">
            Leads
          </Link>
          <Link href="/leads-generieren" className="text-slate-600 hover:text-slate-900">
            Leads generieren
          </Link>
          <Link href="/einstellungen" className="text-slate-600 hover:text-slate-900">
            Einstellungen
          </Link>
          <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/konto" className="text-xs font-normal text-slate-500 hover:text-slate-900" title="Mein Konto" data-testid="angemeldet-als">
              Angemeldet als {me.name} ({ROLLEN_NAME[me.rolle]})
            </Link>
            <LogoutButton />
          </span>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
