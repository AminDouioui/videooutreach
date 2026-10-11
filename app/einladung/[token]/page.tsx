import Link from 'next/link';
import { EinladungAnnehmen } from '@/components/EinladungAnnehmen';
import { EINLADUNG_MELDUNG, pruefeEinladung } from '@/lib/benutzer';
import { ROLLEN_NAME } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Einladung – Video-Outreach', robots: { index: false } };

/** Öffentliche Seite: Einladungslink annehmen (Name + Passwort festlegen). Zeigt nur Rolle und Adresse der Einladung. */
export default async function EinladungPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const st = pruefeEinladung(token);
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">Video-Outreach</h1>
        {st.status === 'gueltig' ? (
          <>
            <p className="mb-5 text-sm text-slate-500">
              {st.zuruecksetzen ? 'Neues Passwort für' : 'Einladung für'} <strong className="break-all text-slate-700">{st.email}</strong>
              {!st.zuruecksetzen && <> · Rolle: {ROLLEN_NAME[st.rolle]}</>}
            </p>
            <EinladungAnnehmen token={token} zuruecksetzen={st.zuruecksetzen} />
          </>
        ) : (
          <>
            <p role="alert" className="mb-4 mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              {EINLADUNG_MELDUNG[st.status]}
            </p>
            <Link href="/login" className="text-sm text-indigo-600 hover:underline">
              Zur Anmeldung
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
