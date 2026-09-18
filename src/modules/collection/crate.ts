import { t, type MessageKey } from '@/lib/i18n';
import { normalizeText } from '@/modules/catalog/normalize';

import { countryToContinent, type CrateContinent } from './country-to-continent';

export type CrateRecord = {
  releaseId: string;
  discogsReleaseId: string;
  title: string;
  artists: string;
  year: number | null;
  genres: string[];
  country: string | null;
  coverUrl: string | null;
};

export type CrateGrouping = 'genre' | 'year' | 'continent';
export type CrateGroup = { id: string; label: string; items: CrateRecord[] };

const CONTINENT_LABELS: Record<CrateContinent, MessageKey> = {
  africa: 'crate.continent.africa',
  asia: 'crate.continent.asia',
  europe: 'crate.continent.europe',
  northAmerica: 'crate.continent.northAmerica',
  southAmerica: 'crate.continent.southAmerica',
  oceania: 'crate.continent.oceania',
  antarctica: 'crate.continent.antarctica',
  international: 'crate.continent.international',
  unknown: 'crate.continent.unknown',
};

function recordGroup(record: CrateRecord, grouping: CrateGrouping) {
  if (grouping === 'year') {
    const year = record.year;
    return Number.isInteger(year) && year !== null && year > 0
      ? { key: String(year), label: String(year) }
      : { key: 'unknown', label: t('crate.unknownYear') };
  }
  if (grouping === 'continent') {
    const continent = countryToContinent(record.country);
    return { key: continent, label: t(CONTINENT_LABELS[continent]) };
  }
  const genre = record.genres.find((value) => value.trim() !== '')?.trim();
  return genre
    ? { key: normalizeText(genre), label: genre }
    : { key: 'unknown', label: t('crate.unknownGenre') };
}

/**
 * One edition belongs to one crate: its first nonempty Discogs genre is its primary
 * genre. Keep the service's artist/title order within each crate and never mutate the
 * source collection. Missing metadata stays browsable in the final crate.
 */
export function groupCrateRecords(
  records: readonly CrateRecord[],
  grouping: CrateGrouping,
): CrateGroup[] {
  const groups = new Map<string, CrateGroup>();
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.releaseId)) continue;
    seen.add(record.releaseId);
    const { key, label } = recordGroup(record, grouping);
    const id = `${grouping}:${key}`;
    const group = groups.get(id);
    if (group) group.items.push(record);
    else groups.set(id, { id, label, items: [record] });
  }
  return [...groups.values()].sort((a, b) => {
    const unknownId = `${grouping}:unknown`;
    if (a.id === unknownId) return 1;
    if (b.id === unknownId) return -1;
    if (grouping === 'year') return Number(b.label) - Number(a.label);
    return a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' });
  });
}
