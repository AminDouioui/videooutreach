import type { HoeflicherFetcher } from './crawl/fetcher';
import type { ExtractionProvider } from './extract/provider';
import type { SearchProvider } from './search/provider';

/** Austauschbare Bausteine der Stufen (Tests setzen Fakes ein, der Worker die echten Provider). */
export type LeadgenDeps = {
  suche: SearchProvider;
  fetcher: HoeflicherFetcher;
  extraktion: ExtractionProvider;
  /** Lauf, dem Kosten zugerechnet werden */
  runId?: number | null;
};
