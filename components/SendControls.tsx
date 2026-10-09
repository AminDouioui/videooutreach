'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Status = {
  status: string;
  sentToday: number;
  dailyLimit: number;
  sentTodayGlobal: number;
  globalLimit: number;
  nextSendAt: number | null;
  quotaStopped: boolean;
  windowOpen: boolean;
  planned: number;
  sent: number;
  errors: number;
  gmailConnected: boolean;
  followupSchritte: number;
  followupsGesendet: number;
  antworten: number;
  bounces: number;
  antwortPruefung: boolean;
};

const knopf = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60';

function zeit(ms: number): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
}

/** Versandsteuerung der Kampagne: starten, pausieren, fortsetzen + Tagesstand. */
export function SendControls({ campaignId, readyCount }: { campaignId: number; readyCount: number }) {
  const router = useRouter();
  const [s, setS] = useState<Status | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);

  const laden = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/send`, { cache: 'no-store' });
      if (res.ok) setS(await res.json());
    } catch {
      // Netzwerkfehler: beim nächsten Intervall erneut
    }
  }, [campaignId]);

  useEffect(() => {
    laden();
    const t = setInterval(laden, 5000);
    return () => clearInterval(t);
  }, [laden]);

  async function aktion(action: 'start' | 'pause' | 'resume' | 'stop') {
    if (action === 'stop' && !confirm('Kampagne abbrechen? Geplante Mails und ausstehende Follow-ups werden nicht mehr gesendet. Bereits gesendete bleiben unberührt; ein Neustart ist jederzeit möglich.')) return;
    setLaedt(true);
    setMeldung(null);
    const res = await fetch(`/api/campaigns/${campaignId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setMeldung(data.warning ? { text: data.warning, fehler: false } : null);
    else setMeldung({ text: data.error ?? 'Aktion fehlgeschlagen', fehler: true });
    await laden();
    router.refresh();
    setLaedt(false);
  }

  if (!s) return <div className="h-[62px] rounded-lg border border-slate-200 bg-white" aria-busy="true" />;
  const status = s.status;
  const laeuft = status === 'versendet_laufend';
  const naechster =
    laeuft && s.nextSendAt && s.nextSendAt > Date.now() ? `Nächster Versand frühestens ${zeit(s.nextSendAt)}` : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        {!laeuft && status !== 'pausiert' && (
          <button onClick={() => aktion('start')} disabled={laedt || readyCount === 0} title={readyCount === 0 ? 'Noch keine versandbereiten Leads' : undefined} className={`${knopf} bg-indigo-600 text-white hover:bg-indigo-700`}>
            Kampagne starten
          </button>
        )}
        {laeuft && (
          <button onClick={() => aktion('pause')} disabled={laedt} className={`${knopf} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
            Kampagne pausieren
          </button>
        )}
        {status === 'pausiert' && (
          <button onClick={() => aktion('resume')} disabled={laedt} className={`${knopf} bg-indigo-600 text-white hover:bg-indigo-700`}>
            Fortsetzen
          </button>
        )}
        {(laeuft || status === 'pausiert') && (
          <button onClick={() => aktion('stop')} disabled={laedt} className={`${knopf} border border-red-200 bg-white text-red-700 hover:bg-red-50`}>
            Kampagne abbrechen
          </button>
        )}
        <p className="text-sm text-slate-600">
            Heute gesendet <strong>{s.sentToday} / {s.dailyLimit}</strong>
            <span className="text-slate-400"> (alle Kampagnen: {s.sentTodayGlobal} / {s.globalLimit})</span>
            {s.planned > 0 && <> · {s.planned} geplant</>}
            {s.errors > 0 && <> · <span className="text-red-600">{s.errors} Fehler</span></>}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
        <span>
          Erstmails gesendet: <strong>{s.sent}</strong>
        </span>
        {s.followupSchritte > 0 && (
          <span>
            Follow-ups gesendet: <strong>{s.followupsGesendet}</strong>
          </span>
        )}
        <span>
          Antworten: <strong className={s.antworten > 0 ? 'text-green-700' : undefined}>{s.antworten}</strong>
        </span>
        {s.bounces > 0 && (
          <span>
            Bounces: <strong className="text-red-600">{s.bounces}</strong>
          </span>
        )}
      </div>
      {laeuft && (
        <p className="mt-2 text-xs text-slate-500">
          {s.quotaStopped
            ? 'Gmail-Limit erreicht – der Versand ruht bis morgen.'
            : !s.windowOpen
              ? 'Außerhalb des Versandfensters – es wird gesendet, sobald es öffnet.'
              : (naechster ?? 'Nächste Mail wird in Kürze gesendet.')}
        </p>
      )}
      {s.gmailConnected && s.followupSchritte > 0 && !s.antwortPruefung && (
        <p className="mt-2 text-xs text-amber-700">
          Follow-ups werden nicht gesendet, bis Gmail unter Einstellungen neu verbunden ist – die Antwort-Erkennung braucht eine zusätzliche Berechtigung (nur Kopfzeilen, keine Inhalte).
        </p>
      )}
      {!s.gmailConnected && <p className="mt-2 text-xs text-amber-700">Gmail ist nicht verbunden – bitte unter Einstellungen verbinden.</p>}
      {meldung && <p className={`mt-2 text-sm ${meldung.fehler ? 'text-red-600' : 'text-amber-700'}`}>{meldung.text}</p>}
    </div>
  );
}
