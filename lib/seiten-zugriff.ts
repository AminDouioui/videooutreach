import { redirect } from 'next/navigation';
import { hatRolle, type Rolle } from './auth';
import { aktuellerBenutzer, type AngemeldeterBenutzer } from './session';

/**
 * Zugriffsprüfung für Seiten des Dashboards. Layouts laufen bei der Navigation im Browser nicht erneut, deshalb ruft
 * jede Seite (und das Layout) diese Prüfung selbst auf: ohne gültige Session → /login, ohne ausreichende Rolle → Startseite.
 */
export async function erforderSeitenRolle(mindestens: Rolle = 'lesen'): Promise<AngemeldeterBenutzer> {
  const benutzer = await aktuellerBenutzer();
  if (!benutzer) redirect('/login');
  if (!hatRolle(benutzer.rolle, mindestens)) redirect('/?keinzugriff=1');
  return benutzer;
}
