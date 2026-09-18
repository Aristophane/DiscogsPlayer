import { describe, expect, it } from 'vitest';

import { t } from '@/lib/i18n';
import { countryToContinent } from '@/modules/collection/country-to-continent';
import { groupCrateRecords, type CrateRecord } from '@/modules/collection/crate';

function record(id: string, extra: Partial<CrateRecord> = {}): CrateRecord {
  return {
    releaseId: id,
    discogsReleaseId: id,
    title: `Album ${id}`,
    artists: `Artiste ${id}`,
    year: null,
    genres: [],
    country: null,
    originCountries: null,
    originSourceUrls: [],
    coverUrl: null,
    ...extra,
  };
}

describe('bacs de la collection', () => {
  it('classe chaque édition dans son premier genre renseigné, sans perdre les genres absents', () => {
    const albums = [
      record('a', { genres: [' ', 'Rock', 'Jazz'] }),
      record('b', { genres: ['Electronic'] }),
      record('c', { genres: [' rock '] }),
      record('d'),
      record('e', { genres: ['Jazz', 'Electronic'] }),
    ];
    const before = structuredClone(albums);
    const groups = groupCrateRecords(albums, 'genre');
    expect(groups.map((group) => group.label)).toEqual([
      'Electronic',
      'Jazz',
      'Rock',
      t('crate.unknownGenre'),
    ]);
    expect(groups[2]?.items.map((item) => item.releaseId)).toEqual(['a', 'c']);
    expect(groups.flatMap((group) => group.items)).toHaveLength(albums.length);
    expect(albums).toEqual(before);
  });

  it('range les années des plus récentes aux plus anciennes, puis celles non renseignées', () => {
    const groups = groupCrateRecords(
      [
        record('a', { year: 1989 }),
        record('b', { year: 2025 }),
        record('c', { year: 0 }),
        record('d'),
        record('e', { year: -1 }),
        record('f', { year: 2025 }),
      ],
      'year',
    );
    expect(groups.map((group) => group.label)).toEqual(['2025', '1989', t('crate.unknownYear')]);
    expect(groups[0]?.items.map((item) => item.releaseId)).toEqual(['b', 'f']);
    expect(groups[2]?.items.map((item) => item.releaseId)).toEqual(['c', 'd', 'e']);
  });

  it('classe par origine des artistes, indépendamment du marché de l’édition', () => {
    const groups = groupCrateRecords(
      [
        record('a', { country: 'France', originCountries: ['Senegal'] }),
        record('b', { country: 'France', originCountries: ['US', 'Senegal'] }),
        record('c', { country: 'France', originCountries: ['Japan'] }),
        record('d', { country: 'France' }),
        record('e', { country: 'US', originCountries: ['Unknown'] }),
        record('f', { country: 'Japan', originCountries: ['Senegal', 'Mali'] }),
      ],
      'continent',
    );
    expect(groups.map((group) => group.label)).toEqual([
      t('crate.continent.africa'),
      t('crate.continent.asia'),
      t('crate.continent.international'),
      t('crate.continent.unknown'),
    ]);
    expect(groups[0]?.items.map((item) => item.releaseId)).toEqual(['a', 'f']);
    expect(groups.at(-1)?.id).toBe('continent:unknown');
    expect(groups.at(-1)?.items.map((item) => item.releaseId)).toEqual(['d', 'e']);
  });

  it('ne duplique pas une édition physique et ne crée pas de bac vide', () => {
    const album = record('a', { genres: ['Rock'] });
    expect(groupCrateRecords([album, album], 'genre')[0]?.items).toHaveLength(1);
    expect(groupCrateRecords([], 'genre')).toEqual([]);
    expect(groupCrateRecords([], 'year')).toEqual([]);
    expect(groupCrateRecords([], 'continent')).toEqual([]);
  });
});

describe('continents des territoires Discogs', () => {
  it.each([
    ['France', 'europe'],
    ['US', 'northAmerica'],
    ['Mexico', 'northAmerica'],
    ['Brazil', 'southAmerica'],
    ['Japan', 'asia'],
    ['South Africa', 'africa'],
    ['New Zealand', 'oceania'],
    ['Antarctica', 'antarctica'],
    ['UK', 'europe'],
    ['Czechoslovakia', 'europe'],
    ['German Democratic Republic (GDR)', 'europe'],
    ['Trinidad & Tobago', 'northAmerica'],
    ['Bosnia and Herzegovina', 'europe'],
    ['Russia', 'europe'],
    ['Turkey', 'asia'],
    ['  Côte d’Ivoire  ', 'africa'],
  ])('reconnaît %s', (country, expected) => {
    expect(countryToContinent(country)).toBe(expected);
  });

  it.each([
    ['UK & Europe', 'europe'],
    ['US & Canada', 'northAmerica'],
    ['Germany, Austria, & Switzerland', 'europe'],
    ['Australia & New Zealand', 'oceania'],
    ['US & Europe', 'international'],
    ['UK, Europe & US', 'international'],
    ['Japan / Europe', 'international'],
    ['Worldwide', 'international'],
    ['USSR', 'international'],
    ['Atlantis & Europe', 'unknown'],
    ['France &', 'unknown'],
    [null, 'unknown'],
    ['', 'unknown'],
    ['Unknown', 'unknown'],
  ])('traite prudemment le territoire %s', (country, expected) => {
    expect(countryToContinent(country)).toBe(expected);
  });
});
