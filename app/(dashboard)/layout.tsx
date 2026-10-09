import Link from 'next/link';
import { LogoutButton } from '@/components/LogoutButton';
import { zaehleUngeleseneAntworten } from '@/lib/lead-status-db';

// Der Zähler ungelesener Antworten muss bei jedem Aufruf frisch sein
export const dynamic = 'force-dynamic';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ungelesen = zaehleUngeleseneAntworten();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 text-sm font-medium">
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
          <Link href="/leads" className="text-slate-600 hover:text-slate-900">
            Leads
          </Link>
          <Link href="/einstellungen" className="text-slate-600 hover:text-slate-900">
            Einstellungen
          </Link>
          <span className="ml-auto">
            <LogoutButton />
          </span>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
