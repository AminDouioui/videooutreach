import type { ReactNode } from 'react';

/**
 * Sperrt alle Eingabefelder und Knöpfe darin (natives `fieldset disabled`), wenn die Rolle der Person hier nichts
 * ändern darf. Nur Komfort: die Berechtigung prüfen die API-Routen serverseitig.
 */
export function Schreibschutz({ gesperrt, hinweis, children }: { gesperrt: boolean; hinweis?: string; children: ReactNode }) {
  if (!gesperrt) return <>{children}</>;
  return (
    <>
      {hinweis && <p className="mb-2 rounded-md bg-slate-100 px-3 py-1.5 text-xs text-slate-600">{hinweis}</p>}
      <fieldset disabled className="contents [&_button]:cursor-not-allowed [&_button]:opacity-60 [&_a]:pointer-events-none [&_a]:opacity-60">
        {children}
      </fieldset>
    </>
  );
}
