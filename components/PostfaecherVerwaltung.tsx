'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { istBounceFehler } from '@/lib/bounce-schutz';
import type { PostfachAnzeige } from '@/lib/settings-view';
import { POSTFACH_STATUS_LABEL, type PostfachStatus } from '@/lib/rotation';
import { SmtpPostfachNeu, VerbindungsFelder, type Verbindung } from './SmtpPostfachFormular';

const MELDUNGEN: Record<string, { text: string; fehler: boolean }> = {
  verbunden: { text: 'Postfach wurde verbunden:', fehler: false },
  smtp_angelegt: { text: 'SMTP/IMAP-Postfach wurde angelegt:', fehler: false },
  nicht_konfiguriert: { text: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen in der .env (siehe docs/gmail-einrichtung.md).', fehler: true },
  fehler: { text: 'Verbindung fehlgeschlagen.', fehler: true },
};

const STATUS_FARBE: Record<PostfachStatus, string> = {
  aktiv: 'bg-green-100 text-green-800',
  pausiert: 'bg-slate-200 text-slate-700',
  fehler: 'bg-red-100 text-red-800',
  getrennt: 'bg-slate-200 text-slate-700',
  heute_gestoppt: 'bg-amber-100 text-amber-800',
};

const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
const knopfRahmen = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60';

/** Liste der Postfächer (Gmail und SMTP/IMAP): Status, Tagesstand, Bearbeiten, Pausieren, Neu verbinden, Entfernen, Hinzufügen. */
export function PostfaecherVerwaltung({ postfaecher, konfiguriert, hinweis, detail }: { postfaecher: PostfachAnzeige[]; konfiguriert: boolean; hinweis?: string; detail?: string }) {
  const router = useRouter();
  const [neuSmtp, setNeuSmtp] = useState(false);
  const [angelegt, setAngelegt] = useState<string | null>(null);
  const m = hinweis ? MELDUNGEN[hinweis] : undefined;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">Postfächer</h2>
        <div className="ml-auto flex flex-wrap gap-2">
          <a href="/api/gmail/connect" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
            Gmail-Postfach hinzufügen
          </a>
          <button type="button" onClick={() => setNeuSmtp(!neuSmtp)} aria-expanded={neuSmtp} className="rounded-md border border-indigo-600 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
            SMTP/IMAP-Postfach hinzufügen
          </button>
        </div>
      </div>
      <p className="mb-3 text-sm text-slate-600">
        Erstmails rotieren über die aktiven Postfächer (zuerst das mit den wenigsten Mails heute). Follow-ups und die Antwort-Erkennung laufen immer über das
        Postfach der Erstmail.
      </p>
      {!konfiguriert && hinweis !== 'nicht_konfiguriert' && <p className="mb-3 text-sm text-amber-700">Google-Zugangsdaten fehlen in der .env. Anleitung: docs/gmail-einrichtung.md</p>}
      {m && (
        <p className={`mb-3 text-sm ${m.fehler ? 'text-red-600' : 'text-green-700'}`}>
          {m.text} {detail}
        </p>
      )}
      {angelegt && <p className="mb-3 text-sm text-green-700">{MELDUNGEN.smtp_angelegt.text} {angelegt}</p>}
      {neuSmtp && (
        <SmtpPostfachNeu
          onAbbruch={() => setNeuSmtp(false)}
          onFertig={(email) => {
            setNeuSmtp(false);
            setAngelegt(email);
            router.refresh();
          }}
        />
      )}
      {postfaecher.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">Noch kein Postfach verbunden. Ohne Postfach wird nichts gesendet. Gmail-Konten werden per Google-Anmeldung verbunden, alle anderen Anbieter (Outlook, IONOS, Strato …) über SMTP/IMAP.</p>
      ) : (
        <ul className="space-y-3">
          {postfaecher.map((p) => (
            <PostfachZeile key={p.id} p={p} />
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Angefordert werden „E-Mails senden“ (gmail.send), „Kopfzeilen lesen“ (gmail.metadata, nur um Antworten auf eigene Mails zu erkennen – kein Zugriff auf
        Mail-Inhalte) sowie openid/email (die Adresse des Kontos). Optional je Postfach „Lesezugriff erteilen“ (gmail.readonly): Dann zeigt die Unibox den Verlauf unter
        „Antworten“ und Antworten lassen sich direkt aus der App senden. Die Zugriffstoken werden verschlüsselt gespeichert. Bei SMTP/IMAP-Postfächern werden
        die Passwörter verschlüsselt gespeichert und nie wieder angezeigt; die Antwort-Erkennung und die Unibox lesen über IMAP.
      </p>
    </section>
  );
}

function PostfachZeile({ p }: { p: PostfachAnzeige }) {
  const router = useRouter();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [laedt, setLaedt] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);
  const [w, setW] = useState({ name: p.name, tageslimit: p.tageslimit, signatur: p.signatur, rampeBeginn: p.rampeBeginn });
  const smtp = p.typ === 'smtp';
  // Verbindungsangaben (nur SMTP/IMAP); Passwörter bleiben leer = unverändert
  const [v, setV] = useState<Verbindung>({
    smtpHost: p.smtp?.host ?? '',
    smtpPort: p.smtp?.port ?? 587,
    smtpSicherheit: p.smtp?.sicherheit ?? 'starttls',
    smtpBenutzer: p.smtp?.benutzer ?? '',
    smtpPasswort: '',
    imapHost: p.imap?.host ?? '',
    imapPort: p.imap?.port ?? 993,
    imapSicherheit: p.imap?.sicherheit ?? 'ssl',
    imapBenutzer: p.imap?.benutzer ?? '',
    imapPasswort: '',
    imapKopieGesendet: p.imap?.kopieGesendet ?? true,
  });

  async function patch(daten: Record<string, unknown>, ok = 'Gespeichert') {
    setLaedt(true);
    setMeldung(null);
    const res = await fetch(`/api/absender/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(daten) });
    const data = await res.json().catch(() => ({}));
    setLaedt(false);
    if (res.ok) {
      setMeldung({ text: ok, fehler: false });
      setBearbeiten(false);
      router.refresh();
    } else setMeldung({ text: data.error ?? 'Speichern fehlgeschlagen', fehler: true });
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    await patch({
      name: w.name.trim() || null,
      tageslimit: Number(w.tageslimit),
      signatur: w.signatur.trim() || null,
      rampeBeginn: w.rampeBeginn || null,
      ...(smtp
        ? {
            smtpHost: v.smtpHost,
            smtpPort: v.smtpPort,
            smtpSicherheit: v.smtpSicherheit,
            smtpBenutzer: v.smtpBenutzer,
            imapHost: v.imapHost,
            imapPort: v.imapPort,
            imapSicherheit: v.imapSicherheit,
            imapBenutzer: v.imapBenutzer,
            imapKopieGesendet: v.imapKopieGesendet,
            // Leere Passwortfelder werden nicht gesendet: die gespeicherten bleiben unverändert
            ...(v.smtpPasswort ? { smtpPasswort: v.smtpPasswort } : {}),
            ...(v.imapPasswort ? { imapPasswort: v.imapPasswort } : {}),
          }
        : {}),
    });
  }

  async function entfernen() {
    const ende = smtp ? 'die gespeicherten Zugangsdaten löschen' : 'den Zugriff bei Google widerrufen';
    const hinweis =
      p.leads > 0
        ? `${p.leads} Lead(s) wurden über dieses Postfach angeschrieben. Der Eintrag bleibt deaktiviert erhalten, deren Follow-ups warten dann, bis das Postfach neu verbunden wird. Zugriff trennen?`
        : `Postfach entfernen und ${ende}?`;
    if (!confirm(`${p.email}: ${hinweis}`)) return;
    setLaedt(true);
    await fetch(`/api/absender/${p.id}`, { method: 'DELETE' });
    setLaedt(false);
    router.refresh();
  }

  return (
    <li className="rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="break-all font-medium">{p.email}</span>
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${smtp ? 'bg-teal-100 text-teal-800' : 'bg-indigo-100 text-indigo-800'}`}
          title={smtp ? 'Versand über SMTP, Antworten über IMAP' : 'Versand und Antworten über die Gmail-API'}
        >
          {smtp ? 'SMTP/IMAP' : 'Gmail'}
        </span>
        {p.name && <span className="text-sm text-slate-500">{p.name}</span>}
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_FARBE[p.status]}`}>{POSTFACH_STATUS_LABEL[p.status]}</span>
        <span className="text-sm tabular-nums text-slate-600" title="Heute gesendet / effektives Tageslimit (Rampe berücksichtigt)">
          Heute {p.heuteGesendet} / {p.limitHeute}
        </span>
        {p.verbunden && (
          <span className={`text-xs ${p.antwortPruefung ? 'text-slate-500' : 'font-medium text-amber-700'}`} title="Voraussetzung für Follow-ups: Antworten auf eigene Mails erkennen">
            Antwortprüfung: {p.antwortPruefung ? 'ja' : 'nein'}
          </span>
        )}
        {p.verbunden && (
          <span className="text-xs text-slate-500" title={smtp ? 'Verlauf per IMAP lesen und aus der App antworten' : 'Lesezugriff (gmail.readonly): Verlauf lesen und aus der App antworten'}>
            Unibox: {p.unibox ? 'ja' : 'nein'}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {p.verbunden && (
            <button onClick={() => patch({ aktiv: !p.aktiv }, p.aktiv ? 'Pausiert' : 'Aktiviert')} disabled={laedt} className={knopfRahmen}>
              {p.aktiv ? 'Pausieren' : 'Aktivieren'}
            </button>
          )}
          <button onClick={() => setBearbeiten(!bearbeiten)} className={knopfRahmen}>
            Bearbeiten
          </button>
          {!smtp && p.verbunden && !p.unibox && (
            <a href={`/api/gmail/connect?absender=${p.id}&lesezugriff=1`} className={knopfRahmen} title="Zusätzlich gmail.readonly anfordern, damit Antworten in der App gelesen und beantwortet werden können">
              Lesezugriff erteilen
            </a>
          )}
          {!smtp && (
            <a href={`/api/gmail/connect?absender=${p.id}`} className={knopfRahmen}>
              Neu verbinden
            </a>
          )}
          <button onClick={entfernen} disabled={laedt} className={`${knopfRahmen} text-red-700`}>
            Entfernen
          </button>
        </div>
      </div>
      {p.fehler && istBounceFehler(p.fehler) && (
        <p className="mt-2 text-sm text-amber-800">
          Automatisch pausiert (Bounce-Schutz): {p.fehler}. Nach Prüfung der Adressliste mit „Aktivieren“ wieder freigeben.
        </p>
      )}
      {p.fehler && !istBounceFehler(p.fehler) && (
        <p className="mt-2 break-words text-sm text-red-700">
          Pausiert wegen Fehler ({smtp ? 'bitte Zugangsdaten unter „Bearbeiten“ prüfen' : 'bitte neu verbinden'}): {p.fehler}
        </p>
      )}
      {smtp && p.smtp && p.imap && (
        <p className="mt-1 break-all text-xs text-slate-500">
          SMTP {p.smtp.host}:{p.smtp.port} ({p.smtp.sicherheit === 'ssl' ? 'SSL' : p.smtp.sicherheit === 'starttls' ? 'STARTTLS' : 'unverschlüsselt'}) · IMAP {p.imap.host}:{p.imap.port} ({p.imap.sicherheit === 'ssl' ? 'SSL' : p.imap.sicherheit === 'starttls' ? 'STARTTLS' : 'unverschlüsselt'})
        </p>
      )}
      {!p.verbunden && (
        <p className="mt-2 text-sm text-slate-500">
          Nicht verbunden{smtp ? ' (Zugangsdaten gelöscht – unter „Bearbeiten“ neu eintragen)' : ''}
          {p.leads > 0 ? ` – ${p.leads} Lead(s) hängen noch an diesem Postfach, ihre Follow-ups warten.` : '.'}
        </p>
      )}
      {!smtp && p.verbunden && !p.antwortPruefung && (
        <p className="mt-2 text-sm text-amber-800">Für Follow-ups dieses Postfachs bitte „Neu verbinden“: Die Antwort-Erkennung braucht eine zusätzliche Berechtigung.</p>
      )}
      {bearbeiten && (
        <form onSubmit={speichern} className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Name
              <input value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} className={feld} placeholder="leer = Standard-Absendername" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Tageslimit
              <input required type="number" min={1} max={2000} value={w.tageslimit} onChange={(e) => setW({ ...w, tageslimit: Number(e.target.value) })} className={feld} />
            </label>
          </div>
          <label className="block text-sm font-medium text-slate-700">
            Signatur
            <textarea value={w.signatur} onChange={(e) => setW({ ...w, signatur: e.target.value })} rows={5} className={`${feld} font-mono`} placeholder="leer = Standard-Signatur" />
          </label>
          {smtp && <VerbindungsFelder v={v} setV={setV} email={p.email} absenderId={p.id} />}
          <label className="block text-sm font-medium text-slate-700 sm:max-w-xs">
            Rampen-Beginn (optional)
            <input type="date" value={w.rampeBeginn} onChange={(e) => setW({ ...w, rampeBeginn: e.target.value })} className={feld} />
            <span className="mt-1 block text-xs font-normal text-slate-500">Nur bei aktiver Aufwärmrampe. Leer = Tag der ersten Mail dieses Postfachs.</span>
          </label>
          <button type="submit" disabled={laedt} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
            Speichern
          </button>
        </form>
      )}
      {meldung && <p className={`mt-2 text-sm ${meldung.fehler ? 'text-red-600' : 'text-green-700'}`}>{meldung.text}</p>}
    </li>
  );
}
