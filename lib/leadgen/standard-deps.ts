import { z } from 'zod';
import { getEnv } from '@/lib/env';
import { getSetting, kiSchluessel } from '@/lib/settings';
import { RollenDefinition, STANDARD_ROLLEN, STANDARD_SUCHVORLAGEN, type Suchvorlage } from './config';
import { standardRollen, Rollenverzeichnis } from './contacts/rollen';
import { ReacherVerifier } from './contacts/reacher';
import type { KontaktDeps } from './contacts/steps';
import { GedrosselterVerifier } from './contacts/verifier';
import { HoeflicherFetcher } from './crawl/fetcher';
import { OpenAiExtractionProvider } from './extract/openai-provider';
import { BraveSearchProvider, braveSchluessel } from './search/brave';

// Die echten Bausteine für den Worker: Brave-Suche, höflicher Fetcher, OpenAI-Extraktion, Reacher-Verifizierung. Rollen und Suchvorlagen
// lassen sich per Einstellung überschreiben (JSON), sonst gelten die Standardwerte aus config.ts.

const rollenSchema = z.array(z.object({ key: z.string().min(1), label: z.string().min(1), synonyme: z.array(z.string()), fallbacks: z.array(z.string()) })).min(1);
const vorlagenSchema = z.array(z.object({ tag: z.enum(['suche', 'stellenanzeige', 'presse', 'messe', 'netzwerk']), vorlage: z.string().min(3) })).min(1);

function jsonEinstellung<T>(key: 'leadgen_rollen' | 'leadgen_suchvorlagen', schema: z.ZodType<T>): T | null {
  const roh = getSetting(key);
  if (!roh) return null;
  try {
    const r = schema.safeParse(JSON.parse(roh));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function ladeRollen(): Rollenverzeichnis {
  const eigene = jsonEinstellung('leadgen_rollen', rollenSchema) as RollenDefinition[] | null;
  return eigene ? new Rollenverzeichnis(eigene) : standardRollen;
}

export function ladeRollenDefinitionen(): RollenDefinition[] {
  return (jsonEinstellung('leadgen_rollen', rollenSchema) as RollenDefinition[] | null) ?? STANDARD_ROLLEN;
}

export function ladeSuchvorlagen(): Suchvorlage[] {
  return (jsonEinstellung('leadgen_suchvorlagen', vorlagenSchema) as Suchvorlage[] | null) ?? STANDARD_SUCHVORLAGEN;
}

// Fetcher und Verifizierer sind je Prozess einmalig: ihre Drosselung (Abstand je Domain, robots.txt-Merker) muss über alle Jobs und
// Läufe hinweg gelten, sonst würde jeder Job bei null anfangen und eine Domain zu schnell hintereinander anfragen.
let gemeinsamerFetcher: HoeflicherFetcher | null = null;
let gemeinsamerVerifier: GedrosselterVerifier | null = null;

export function erzeugeStandardDeps(runId: number): KontaktDeps {
  gemeinsamerFetcher ??= new HoeflicherFetcher();
  gemeinsamerVerifier ??= new GedrosselterVerifier({ verifier: new ReacherVerifier() });
  return {
    suche: new BraveSearchProvider({ runId }),
    fetcher: gemeinsamerFetcher,
    extraktion: new OpenAiExtractionProvider({ runId }),
    verifier: gemeinsamerVerifier,
    rollen: ladeRollen(),
    suchvorlagen: ladeSuchvorlagen(),
    runId,
  };
}

export type Voraussetzungen = { suche: boolean; extraktion: boolean; verifizierung: boolean; hinweise: string[] };

/** Welche externen Dienste sind konfiguriert? Fehlende lassen den Lauf zu, aber die jeweilige Stufe liefert dann weniger. */
export function pruefeVoraussetzungen(): Voraussetzungen {
  const suche = !!braveSchluessel();
  const extraktion = !!kiSchluessel('openai');
  const verifizierung = !!getEnv().REACHER_URL;
  const hinweise: string[] = [];
  if (!suche) hinweise.push('Kein Brave-Search-Schlüssel: Domain-Ermittlung und Personensuche funktionieren nicht.');
  if (!extraktion) hinweise.push('Kein OpenAI-Schlüssel: die Extraktion (Zuordnung von Personen, Branche) funktioniert nicht.');
  if (!verifizierung) hinweise.push('Keine REACHER_URL: E-Mail-Adressen werden nicht per SMTP geprüft, es gibt höchstens unverifizierte Treffer.');
  return { suche, extraktion, verifizierung, hinweise };
}
