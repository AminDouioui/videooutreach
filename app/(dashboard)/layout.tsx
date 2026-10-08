import Link from 'next/link';
import { LogoutButton } from '@/components/LogoutButton';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 text-sm font-medium">
          <span className="font-semibold text-indigo-600">Video-Outreach</span>
          <Link href="/" className="text-slate-600 hover:text-slate-900">
            Kampagnen
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
