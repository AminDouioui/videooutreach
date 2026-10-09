'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const MELDUNGEN: Record<string, { text: string; fehler: boolean }> = {
  verbunden: { text: 'Gmail wurde verbunden.', fehler: false },
  nicht_konfiguriert: { text: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen in der .env (siehe docs/gmail-einrichtung.md).', fehler: true },
  fehler: { text: 'Verbindung fehlgeschlagen.', fehler: true },
};

export function GmailStatus({
  connected,
  email,
  configured,
  hinweis,
  detail,
  antwortPruefung = false,
}: {
  connected: boolean;
  email: string | null;
  configured: boolean;
  hinweis?: string;
  detail?: string;
  /** Leseberechtigung für Kopfzeilen erteilt (Antwort-Erkennung der Follow-ups) */
  antwortPruefung?: boolean;
}) {
  const router = useRouter();
  const [laedt, setLaedt] = useState(false);
  const m = hinweis ? MELDUNGEN[hinweis] : undefined;

  async function trennen() {
    if (!confirm('Gmail-Verbindung wirklich trennen? Der Versand pausiert, bis neu verbunden wird.')) return;
    setLaedt(true);
    await fetch('/api/gmail/disconnect', { method: 'POST' });
    setLaedt(false);
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-base font-semibold">Gmail</h2>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${connected ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{connected ? 'Verbunden' : 'Nicht verbunden'}</span>
        {connected && email && <span className="text-sm text-slate-600">Absender: {email}</span>}
        {connected ? (
          <button onClick={trennen} disabled={laedt} className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            Verbindung trennen
          </button>
        ) : (
          <a href="/api/gmail/connect" className="ml-auto rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
            Gmail verbinden
          </a>
        )}
      </div>
      {!configured && !connected && hinweis !== 'nicht_konfiguriert' && <p className="mt-3 text-sm text-amber-700">Google-Zugangsdaten fehlen in der .env. Anleitung: docs/gmail-einrichtung.md</p>}
      {m && (
        <p className={`mt-3 text-sm ${m.fehler ? 'text-red-600' : 'text-green-700'}`}>
          {m.text} {detail}
        </p>
      )}
      {connected && !antwortPruefung && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          <span>Für Follow-ups bitte neu verbinden: Die Antwort-Erkennung braucht eine zusätzliche Berechtigung.</span>
          <a href="/api/gmail/connect" className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700">
            Neu verbinden
          </a>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Angefordert werden „E-Mails senden“ (gmail.send) und „Kopfzeilen lesen“ (gmail.metadata, nur um Antworten auf eigene Mails zu erkennen – kein Zugriff auf
        Mail-Inhalte). Der Zugriffstoken wird verschlüsselt gespeichert.
      </p>
    </section>
  );
}
