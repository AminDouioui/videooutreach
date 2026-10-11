import { istLeadStatus, type LeadStatus } from './lead-status';

// Untersequenzen: reine Prüflogik (ohne Datenbank), ob ein Lead in die Ziel-Kampagne übernommen wird

export type UebernahmeAusschluss = 'ziel_gleich_quelle' | 'gesperrt' | 'abgemeldet' | 'schon_in_ziel';

export const AUSSCHLUSS_TEXT: Record<UebernahmeAusschluss, string> = {
  ziel_gleich_quelle: 'Ziel-Kampagne ist die Quell-Kampagne',
  gesperrt: 'Adresse oder Domain steht auf der Sperrliste',
  abgemeldet: 'Lead hat sich abgemeldet',
  schon_in_ziel: 'Lead mit dieser E-Mail ist schon in der Ziel-Kampagne',
};

/** Warum der Lead NICHT übernommen wird (null = übernehmen). Reihenfolge = Priorität der Meldung. */
export function pruefeUebernahme(p: { quelleCampaignId: number; zielCampaignId: number; abgemeldet: boolean; gesperrt: boolean; schonInZiel: boolean }): UebernahmeAusschluss | null {
  if (p.quelleCampaignId === p.zielCampaignId) return 'ziel_gleich_quelle';
  if (p.abgemeldet) return 'abgemeldet';
  if (p.gesperrt) return 'gesperrt';
  if (p.schonInZiel) return 'schon_in_ziel';
  return null;
}

/** Status, die als Auslöser einer Regel taugen („offen“ ist der Ausgangszustand und löst nichts aus) */
export function istAusloeserStatus(v: unknown): v is LeadStatus {
  return istLeadStatus(v) && v !== 'offen';
}
