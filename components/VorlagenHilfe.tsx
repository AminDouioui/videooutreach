import type { OrtVerstoss } from '@/lib/schreibregeln';

const MAX_ANZEIGE = 6;

/** Fundstelle als Text, der Treffer ist mit <mark> hervorgehoben (reiner Text, React-escaped). */
function Fundstelle({ stelle, von, bis }: { stelle: string; von: number; bis: number }) {
  return (
    <span className="break-words font-mono">
      {stelle.slice(0, von)}
      <mark className="rounded bg-amber-300 px-0.5 text-slate-900">{stelle.slice(von, bis) || ' '}</mark>
      {stelle.slice(bis)}
    </span>
  );
}

/**
 * Warnung zu den Prozessia-Schreibregeln (Gedankenstriche, Trenn-Bindestriche, Klammern, behauptete Gespräche) mit Fundstellen.
 * Blockiert nichts; `titel` = Einleitungstext.
 */
export function SchreibregelnWarnung({ verstoesse, titel, hinweis = 'Speichern ist trotzdem möglich.' }: { verstoesse: OrtVerstoss[]; titel?: string; hinweis?: string }) {
  if (verstoesse.length === 0) return null;
  const sichtbar = verstoesse.slice(0, MAX_ANZEIGE);
  return (
    <div role="alert" data-testid="schreibregeln-warnung" className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <p className="font-semibold">
        {titel ?? 'Verstoß gegen die Prozessia-Schreibregeln'} ({verstoesse.length} {verstoesse.length === 1 ? 'Stelle' : 'Stellen'})
      </p>
      <ul className="mt-1 space-y-1">
        {sichtbar.map(({ ort, verstoss: v }, i) => (
          <li key={i} className="flex flex-wrap gap-x-2">
            <span className="font-medium">
              {ort ? `${ort}: ` : ''}
              {v.label}
            </span>
            <Fundstelle stelle={v.stelle} von={v.markVon} bis={v.markBis} />
          </li>
        ))}
      </ul>
      {verstoesse.length > sichtbar.length && <p className="mt-1">… und {verstoesse.length - sichtbar.length} weitere.</p>}
      <p className="mt-1 text-amber-800">Bitte mit ganzen Sätzen, Doppelpunkt oder Komma umformulieren. {hinweis}</p>
    </div>
  );
}

/** Spintax-/Fallback-Hilfe und Warnungen für die Vorlagen-Editoren. */
export function VorlagenHinweise({ fehler, unbekannt, schreibregeln = [] }: { fehler: string[]; unbekannt: string[]; /** Verstöße gegen die Schreibregeln (leer = keine oder Prüfung aus) */ schreibregeln?: OrtVerstoss[] }) {
  return (
    <div className="mt-2 space-y-2">
      <SchreibregelnWarnung verstoesse={schreibregeln} />
      {fehler.length > 0 && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
          Klammern nicht ausgeglichen – Speichern nicht möglich: {fehler.join('; ')}
        </p>
      )}
      {unbekannt.length > 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Unbekannter Platzhalter: {unbekannt.map((u) => `{{${u}}}`).join(', ')}. Er bleibt in der Mail wörtlich stehen, sofern es keine Spalte der Leads dieser Kampagne ist.
        </p>
      )}
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">Hilfe: Spintax und Fallbacks</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            <span className="font-mono">{'{Hallo|Guten Tag|Moin}'}</span> wählt pro Lead eine Variante (stabil: Vorschau und Versand sind identisch). Verschachtelung ist erlaubt, z. B.{' '}
            <span className="font-mono">{'{Hallo|Guten {Tag|Morgen}}'}</span>.
          </li>
          <li>
            <span className="font-mono">{'{{vorname|Hallo zusammen}}'}</span> setzt den Fallback-Text, wenn der Wert beim Lead leer ist.
          </li>
          <li>
            Eigene Spalten aus dem Import: Spaltenname in Kleinbuchstaben, Umlaute aufgelöst (ä → ae), andere Zeichen → <span className="font-mono">_</span>, z. B. „Stadt (PLZ)“ → <span className="font-mono">{'{{stadt_plz}}'}</span>.
          </li>
          <li>Spintax im Betreff gilt auch für das „Re: …“ der Follow-ups (gleiche Variante wie in der Erstmail).</li>
        </ul>
      </details>
    </div>
  );
}
