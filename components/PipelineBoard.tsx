'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { LEAD_STATUS, LEAD_STATUS_INFO, type LeadStatus } from '@/lib/lead-status';
import { aggregierePipeline, dealWertEingabe, formatEuro, parseDealWert, tageImStatus, type PipelineLead } from '@/lib/pipeline';

export type PipelineKarte = PipelineLead & {
  firma: string;
  name: string;
  email: string;
  kampagne: string;
  dealNotiz: string | null;
};

const SPALTEN_FARBE: Record<string, string> = {
  grau: 'border-slate-300',
  gruen: 'border-green-500',
  gelb: 'border-amber-400',
  rot: 'border-red-400',
  blau: 'border-indigo-500',
};

const eingabe = 'w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';

async function patch(leadId: number, body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`/api/leads/${leadId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return null;
    return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Fehler ${res.status}`;
  } catch {
    return 'Speichern fehlgeschlagen (keine Verbindung)';
  }
}

/** Kanban-Ansicht der Pipeline: Spalten je Lead-Status, Drag-and-drop (HTML5) und Status-Dropdown als Fallback. */
export function PipelineBoard({ leads: initial, kampagnen, campaignId, jetzt, lesend = false }: { leads: PipelineKarte[]; kampagnen: { id: number; name: string }[]; campaignId: number | null; jetzt: number; lesend?: boolean }) {
  const router = useRouter();
  const [leads, setLeads] = useState(initial);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offenZeigen, setOffenZeigen] = useState(false);
  const [ziehend, setZiehend] = useState<number | null>(null);
  const [ueber, setUeber] = useState<LeadStatus | null>(null);
  useEffect(() => setLeads(initial), [initial]);

  const spalten = useMemo(() => aggregierePipeline(leads, { campaignId }), [leads, campaignId]);
  const gesamtCent = spalten.reduce((s, c) => s + c.summeCent, 0);
  const gesamtAnzahl = spalten.reduce((s, c) => s + c.anzahl, 0);

  async function verschieben(id: number, neu: LeadStatus) {
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.leadStatus === neu) return;
    setFehler(null);
    const vorher = leads;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, leadStatus: neu, leadStatusAt: Date.now() } : l)));
    const f = await patch(id, { leadStatus: neu });
    if (f) {
      setLeads(vorher);
      setFehler(`Status von ${lead.firma} konnte nicht geändert werden: ${f}`);
    } else router.refresh();
  }

  async function speichereDeal(id: number, wert: string, notiz: string): Promise<string | null> {
    const w = parseDealWert(wert);
    if (!w.ok) return 'Ungültiger Betrag (z. B. 1.234,50 €)';
    const f = await patch(id, { dealWert: wert, dealNotiz: notiz.trim() || null });
    if (f) return f;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, dealWert: w.cent, dealNotiz: notiz.trim() || null } : l)));
    router.refresh();
    return null;
  }

  function waehleKampagne(v: string) {
    router.replace(v ? `/pipeline?kampagne=${v}` : '/pipeline');
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Kampagne
          <select value={campaignId ?? ''} onChange={(e) => waehleKampagne(e.target.value)} aria-label="Kampagne filtern" className="max-w-[16rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
            <option value="">Alle Kampagnen</option>
            {kampagnen.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-slate-600" data-testid="pipeline-gesamt">
          {gesamtAnzahl} Lead{gesamtAnzahl === 1 ? '' : 's'} · Deal-Wert gesamt <span className="font-semibold">{formatEuro(gesamtCent)}</span>
        </p>
      </div>
      {fehler && (
        <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </p>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:overflow-x-auto md:pb-3">
        {spalten.map((sp) => {
          const info = LEAD_STATUS_INFO[sp.status];
          const eingeklappt = sp.status === 'offen' && !offenZeigen;
          return (
            <section
              key={sp.status}
              data-testid={`spalte-${sp.status}`}
              onDragOver={(e) => {
                if (ziehend === null || lesend) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (ueber !== sp.status) setUeber(sp.status);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setUeber(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (lesend) return;
                const id = Number(e.dataTransfer.getData('text/plain')) || ziehend;
                setUeber(null);
                setZiehend(null);
                if (id) void verschieben(id, sp.status);
              }}
              className={`rounded-lg border-t-4 bg-slate-100 p-2 ${eingeklappt ? 'md:w-32 md:shrink-0' : 'md:min-w-[9rem] md:flex-1'} ${SPALTEN_FARBE[info.farbe]} ${ueber === sp.status ? 'ring-2 ring-indigo-400' : ''}`}
            >
              <header className="mb-2 flex flex-wrap items-start justify-between gap-2 px-1">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">{info.label}</h2>
                  <p className="text-xs text-slate-500">
                    <span data-testid={`anzahl-${sp.status}`}>{sp.anzahl}</span> · <span data-testid={`summe-${sp.status}`}>{formatEuro(sp.summeCent)}</span>
                  </p>
                </div>
                {sp.status === 'offen' && (
                  <button onClick={() => setOffenZeigen(!offenZeigen)} aria-expanded={!eingeklappt} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50">
                    {eingeklappt ? 'Einblenden' : 'Einklappen'}
                  </button>
                )}
              </header>
              {!eingeklappt && (
                <ul className="space-y-2">
                  {sp.leads.map((l) => (
                    <Karte key={l.id} lesend={lesend} lead={l} jetzt={jetzt} ziehend={ziehend === l.id} onDragStart={() => setZiehend(l.id)} onDragEnd={() => { setZiehend(null); setUeber(null); }} onStatus={(s) => verschieben(l.id, s)} onDeal={speichereDeal} />
                  ))}
                  {sp.leads.length === 0 && <li className="px-1 py-3 text-center text-xs text-slate-400">Keine Leads</li>}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Karte({ lesend, lead, jetzt, ziehend, onDragStart, onDragEnd, onStatus, onDeal }: { lesend: boolean; lead: PipelineKarte; jetzt: number; ziehend: boolean; onDragStart: () => void; onDragEnd: () => void; onStatus: (s: LeadStatus) => void; onDeal: (id: number, wert: string, notiz: string) => Promise<string | null> }) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const [wert, setWert] = useState(dealWertEingabe(lead.dealWert));
  const [notiz, setNotiz] = useState(lead.dealNotiz ?? '');
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tage = tageImStatus(lead, new Date(jetzt));

  async function speichern() {
    setBusy(true);
    setFehler(null);
    const f = await onDeal(lead.id, wert, notiz);
    setBusy(false);
    if (f) setFehler(f);
    else setBearbeiten(false);
  }

  return (
    <li
      draggable={!lesend}
      data-testid={`karte-${lead.id}`}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(lead.id));
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`${lesend ? '' : 'cursor-grab'} rounded-md border border-slate-200 bg-white p-2.5 text-sm shadow-sm ${ziehend ? 'opacity-50' : ''}`}
    >
      <Link href={`/leads/${lead.id}`} className="block break-words font-medium text-indigo-700 hover:underline">
        {lead.firma}
      </Link>
      <p className="break-words text-xs text-slate-600">{lead.name || lead.email}</p>
      <p className="break-words text-xs text-slate-400">{lead.kampagne}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-800" data-testid={`deal-${lead.id}`}>
          {formatEuro(lead.dealWert)}
        </span>
        <span className="text-xs text-slate-500">{tage === null ? '' : tage === 0 ? 'heute' : `${tage} Tag${tage === 1 ? '' : 'e'} im Status`}</span>
      </div>
      {lead.dealNotiz && !bearbeiten && <p className="mt-1 whitespace-pre-line break-words text-xs text-slate-500">{lead.dealNotiz}</p>}
      {bearbeiten ? (
        <div className="mt-2 space-y-1.5">
          <input value={wert} onChange={(e) => setWert(e.target.value)} inputMode="decimal" placeholder="Deal-Wert in € (z. B. 1.234,50)" aria-label="Deal-Wert" className={eingabe} />
          <textarea value={notiz} onChange={(e) => setNotiz(e.target.value)} rows={2} placeholder="Notiz zum Deal" aria-label="Deal-Notiz" className={eingabe} />
          {fehler && <p className="text-xs text-red-700">{fehler}</p>}
          <div className="flex gap-2">
            <button onClick={speichern} disabled={busy} className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              Speichern
            </button>
            <button onClick={() => { setBearbeiten(false); setFehler(null); setWert(dealWertEingabe(lead.dealWert)); setNotiz(lead.dealNotiz ?? ''); }} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
              Abbrechen
            </button>
          </div>
        </div>
      ) : lesend ? null : (
        <button onClick={() => { setWert(dealWertEingabe(lead.dealWert)); setNotiz(lead.dealNotiz ?? ''); setBearbeiten(true); }} className="mt-1 text-xs text-indigo-600 hover:underline">
          Deal bearbeiten
        </button>
      )}
      <select value={lead.leadStatus} onChange={(e) => onStatus(e.target.value as LeadStatus)} aria-label={`Status von ${lead.firma}`} disabled={lesend} className="mt-2 w-full rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs">
        {LEAD_STATUS.map((s) => (
          <option key={s} value={s}>
            {LEAD_STATUS_INFO[s].label}
          </option>
        ))}
      </select>
    </li>
  );
}
