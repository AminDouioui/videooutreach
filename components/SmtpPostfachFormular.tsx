'use client';

import { useState } from 'react';
import { findeVorlage, SICHERHEIT_LABEL, SMTP_VORLAGEN, UNSICHER_HINWEIS, type Sicherheit } from '@/lib/smtp-vorlagen';

// Formularteile für SMTP/IMAP-Postfächer: Anlegen (mit Vorlagen) und die Verbindungsfelder samt „Verbindung testen“,
// die auch das Bearbeiten nutzt. Passwörter werden nie angezeigt oder zurückgegeben; leere Felder beim Bearbeiten = unverändert.

const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
const knopfRahmen = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60';

export type Verbindung = {
  smtpHost: string;
  smtpPort: number;
  smtpSicherheit: Sicherheit;
  smtpBenutzer: string;
  smtpPasswort: string;
  imapHost: string;
  imapPort: number;
  imapSicherheit: Sicherheit;
  imapBenutzer: string;
  imapPasswort: string;
  imapKopieGesendet: boolean;
};

type TestErgebnis = { ok: boolean; smtp?: { ok: boolean; meldung: string }; imap?: { ok: boolean; meldung: string }; error?: string };

/** Server, Benutzer und Passwörter; `absenderId` = bestehendes Postfach (leere Passwörter nutzen die gespeicherten). */
export function VerbindungsFelder({ v, setV, email, absenderId, hinweis }: { v: Verbindung; setV: (v: Verbindung) => void; email: string; absenderId?: number; hinweis?: string }) {
  const [testet, setTestet] = useState(false);
  const [test, setTest] = useState<TestErgebnis | null>(null);
  const bearbeiten = absenderId !== undefined;
  const unsicher = v.smtpSicherheit === 'keine' || v.imapSicherheit === 'keine';

  async function verbindungTesten() {
    setTestet(true);
    setTest(null);
    try {
      const res = await fetch('/api/absender/verbindungstest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(absenderId !== undefined ? { absenderId } : {}),
          ...(email ? { email } : {}),
          smtpHost: v.smtpHost,
          smtpPort: v.smtpPort,
          smtpSicherheit: v.smtpSicherheit,
          smtpBenutzer: v.smtpBenutzer,
          smtpPasswort: v.smtpPasswort,
          imapHost: v.imapHost,
          imapPort: v.imapPort,
          imapSicherheit: v.imapSicherheit,
          imapBenutzer: v.imapBenutzer,
          imapPasswort: v.imapPasswort,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as TestErgebnis;
      setTest(res.ok ? data : { ok: false, error: data.error ?? `Der Test ist fehlgeschlagen (Fehler ${res.status}).` });
    } catch {
      setTest({ ok: false, error: 'Der Server ist nicht erreichbar. Bitte später erneut versuchen.' });
    }
    setTestet(false);
  }

  const zeile = (r: { ok: boolean; meldung: string } | undefined, titel: string) =>
    r && (
      <li className={r.ok ? 'text-green-700' : 'text-red-700'}>
        <span className="font-medium">{titel}:</span> {r.ok ? 'OK – ' : 'Fehler – '}
        {r.meldung}
      </li>
    );

  return (
    <div className="space-y-4">
      {hinweis && <p className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">{hinweis}</p>}
      <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold text-slate-700">SMTP (Versand)</legend>
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem_1fr]">
          <label className="block text-sm font-medium text-slate-700">
            Host
            <input required value={v.smtpHost} onChange={(e) => setV({ ...v, smtpHost: e.target.value })} className={feld} placeholder="smtp.example.de" autoComplete="off" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Port
            <input required type="number" min={1} max={65535} value={v.smtpPort} onChange={(e) => setV({ ...v, smtpPort: Number(e.target.value) })} className={feld} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Verschlüsselung
            <select value={v.smtpSicherheit} onChange={(e) => setV({ ...v, smtpSicherheit: e.target.value as Sicherheit })} className={feld}>
              {(Object.keys(SICHERHEIT_LABEL) as Sicherheit[]).map((s) => (
                <option key={s} value={s}>
                  {SICHERHEIT_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Benutzername
            <input value={v.smtpBenutzer} onChange={(e) => setV({ ...v, smtpBenutzer: e.target.value })} className={feld} placeholder="leer = E-Mail-Adresse" autoComplete="off" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Passwort
            <input
              required={!bearbeiten}
              type="password"
              value={v.smtpPasswort}
              onChange={(e) => setV({ ...v, smtpPasswort: e.target.value })}
              className={feld}
              placeholder={bearbeiten ? 'leer = unverändert' : ''}
              autoComplete="new-password"
            />
          </label>
        </div>
      </fieldset>
      <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold text-slate-700">IMAP (Antworten, Bounces und Unibox lesen)</legend>
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem_1fr]">
          <label className="block text-sm font-medium text-slate-700">
            Host
            <input required value={v.imapHost} onChange={(e) => setV({ ...v, imapHost: e.target.value })} className={feld} placeholder="imap.example.de" autoComplete="off" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Port
            <input required type="number" min={1} max={65535} value={v.imapPort} onChange={(e) => setV({ ...v, imapPort: Number(e.target.value) })} className={feld} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Verschlüsselung
            <select value={v.imapSicherheit} onChange={(e) => setV({ ...v, imapSicherheit: e.target.value as Sicherheit })} className={feld}>
              {(Object.keys(SICHERHEIT_LABEL) as Sicherheit[]).map((s) => (
                <option key={s} value={s}>
                  {SICHERHEIT_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Benutzername
            <input value={v.imapBenutzer} onChange={(e) => setV({ ...v, imapBenutzer: e.target.value })} className={feld} placeholder="leer = wie SMTP" autoComplete="off" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Passwort
            <input
              type="password"
              value={v.imapPasswort}
              onChange={(e) => setV({ ...v, imapPasswort: e.target.value })}
              className={feld}
              placeholder={bearbeiten ? 'leer = unverändert' : 'leer = wie SMTP-Passwort'}
              autoComplete="new-password"
            />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={v.imapKopieGesendet} onChange={(e) => setV({ ...v, imapKopieGesendet: e.target.checked })} className="mt-0.5" />
          <span>
            Kopie jeder gesendeten Mail im „Gesendet“-Ordner ablegen
            <span className="block text-xs text-slate-500">Nötig, damit der Verlauf in der Unibox vollständig ist. Abschalten, wenn der Anbieter gesendete Mails selbst speichert (z. B. Microsoft 365).</span>
          </span>
        </label>
      </fieldset>
      {unsicher && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="font-semibold">Warnung:</span> {UNSICHER_HINWEIS}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={verbindungTesten} disabled={testet} className={knopfRahmen}>
          {testet ? 'Teste …' : 'Verbindung testen'}
        </button>
        <span className="text-xs text-slate-500">Meldet sich an beiden Servern an. Es wird nichts gesendet.</span>
      </div>
      {test && (
        <div role="status" className={`rounded-md border p-3 text-sm ${test.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          {test.error ? (
            <p className="text-red-700">{test.error}</p>
          ) : (
            <ul className="space-y-1 break-words">
              {zeile(test.smtp, 'SMTP')}
              {zeile(test.imap, 'IMAP')}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Verbindungsdaten einer Vorlage (Passwörter leer) */
export function leereVerbindung(): Verbindung {
  const v = SMTP_VORLAGEN[SMTP_VORLAGEN.length - 1];
  return {
    smtpHost: v.smtpHost,
    smtpPort: v.smtpPort,
    smtpSicherheit: v.smtpSicherheit,
    smtpBenutzer: '',
    smtpPasswort: '',
    imapHost: v.imapHost,
    imapPort: v.imapPort,
    imapSicherheit: v.imapSicherheit,
    imapBenutzer: '',
    imapPasswort: '',
    imapKopieGesendet: !v.serverSpeichertGesendet,
  };
}

/** Formular „SMTP/IMAP-Postfach hinzufügen“ mit Vorlagen für gängige Anbieter. */
export function SmtpPostfachNeu({ onFertig, onAbbruch }: { onFertig: (email: string) => void; onAbbruch: () => void }) {
  const [vorlage, setVorlage] = useState('sonstige');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [tageslimit, setTageslimit] = useState(30);
  const [v, setV] = useState<Verbindung>(leereVerbindung());
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  function vorlageWaehlen(schluessel: string) {
    setVorlage(schluessel);
    const t = findeVorlage(schluessel);
    if (!t) return;
    // Bei „Sonstige“ bleiben bereits eingetragene Server stehen
    setV(
      schluessel === 'sonstige'
        ? { ...v, smtpPort: t.smtpPort, smtpSicherheit: t.smtpSicherheit, imapPort: t.imapPort, imapSicherheit: t.imapSicherheit, imapKopieGesendet: !t.serverSpeichertGesendet }
        : { ...v, smtpHost: t.smtpHost, smtpPort: t.smtpPort, smtpSicherheit: t.smtpSicherheit, imapHost: t.imapHost, imapPort: t.imapPort, imapSicherheit: t.imapSicherheit, imapKopieGesendet: !t.serverSpeichertGesendet },
    );
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    setSpeichert(true);
    setFehler(null);
    try {
      const res = await fetch('/api/absender', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || null,
          tageslimit,
          smtpHost: v.smtpHost,
          smtpPort: v.smtpPort,
          smtpSicherheit: v.smtpSicherheit,
          smtpBenutzer: v.smtpBenutzer,
          smtpPasswort: v.smtpPasswort,
          imapHost: v.imapHost,
          imapPort: v.imapPort,
          imapSicherheit: v.imapSicherheit,
          imapBenutzer: v.imapBenutzer,
          ...(v.imapPasswort ? { imapPasswort: v.imapPasswort } : {}),
          imapKopieGesendet: v.imapKopieGesendet,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) onFertig(email.trim().toLowerCase());
      else setFehler(data.error ?? `Speichern fehlgeschlagen (Fehler ${res.status}).`);
    } catch {
      setFehler('Der Server ist nicht erreichbar. Bitte später erneut versuchen.');
    }
    setSpeichert(false);
  }

  return (
    <form onSubmit={speichern} className="mb-4 space-y-4 rounded-md border border-indigo-200 bg-indigo-50/40 p-4" aria-label="SMTP/IMAP-Postfach hinzufügen">
      <h3 className="text-sm font-semibold">SMTP/IMAP-Postfach hinzufügen</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Anbieter (Voreinstellung)
          <select value={vorlage} onChange={(e) => vorlageWaehlen(e.target.value)} className={feld}>
            {SMTP_VORLAGEN.map((t) => (
              <option key={t.schluessel} value={t.schluessel}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          E-Mail-Adresse (Absender)
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={feld} placeholder="vertrieb@example.de" autoComplete="off" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Name (optional)
          <input value={name} onChange={(e) => setName(e.target.value)} className={feld} placeholder="leer = Standard-Absendername" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Tageslimit
          <input required type="number" min={1} max={2000} value={tageslimit} onChange={(e) => setTageslimit(Number(e.target.value))} className={feld} />
        </label>
      </div>
      <VerbindungsFelder v={v} setV={setV} email={email.trim()} hinweis={findeVorlage(vorlage)?.hinweis} />
      {fehler && (
        <p role="alert" className="text-sm text-red-600">
          {fehler}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={speichert} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {speichert ? 'Speichere …' : 'Postfach speichern'}
        </button>
        <button type="button" onClick={onAbbruch} className={knopfRahmen}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
