/** Spintax-/Fallback-Hilfe und Warnungen für die Vorlagen-Editoren. */
export function VorlagenHinweise({ fehler, unbekannt }: { fehler: string[]; unbekannt: string[] }) {
  return (
    <div className="mt-2 space-y-2">
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
