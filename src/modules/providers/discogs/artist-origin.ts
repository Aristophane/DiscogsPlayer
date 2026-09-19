import { DiscogsApiError, getDiscogsArtist } from '@/modules/sync/discogs-api';
import type { ArtistOrigin } from '@/modules/providers/wikidata/artist-origin';

// Only an explicit opening description or birth/formation statement is accepted.
// Countries mentioned in tours, labels, influences or relatives are not artist origins.
const NATIONALITIES: Record<string, string> = {
  French: 'France',
  American: 'United States',
  British: 'United Kingdom',
  English: 'United Kingdom',
  Scottish: 'United Kingdom',
  Welsh: 'United Kingdom',
  Irish: 'Ireland',
  German: 'Germany',
  Italian: 'Italy',
  Spanish: 'Spain',
  Portuguese: 'Portugal',
  Belgian: 'Belgium',
  Dutch: 'Netherlands',
  Swiss: 'Switzerland',
  Austrian: 'Austria',
  Swedish: 'Sweden',
  Norwegian: 'Norway',
  Danish: 'Denmark',
  Finnish: 'Finland',
  Icelandic: 'Iceland',
  Polish: 'Poland',
  Czech: 'Czechia',
  Greek: 'Greece',
  Turkish: 'Turkey',
  Russian: 'Russia',
  Ukrainian: 'Ukraine',
  Romanian: 'Romania',
  Hungarian: 'Hungary',
  Serbian: 'Serbia',
  Croatian: 'Croatia',
  Canadian: 'Canada',
  Mexican: 'Mexico',
  Cuban: 'Cuba',
  Jamaican: 'Jamaica',
  Haitian: 'Haiti',
  Brazilian: 'Brazil',
  Argentinian: 'Argentina',
  Argentine: 'Argentina',
  Chilean: 'Chile',
  Colombian: 'Colombia',
  Peruvian: 'Peru',
  Venezuelan: 'Venezuela',
  Australian: 'Australia',
  'New Zealand': 'New Zealand',
  Japanese: 'Japan',
  Chinese: 'China',
  Taiwanese: 'Taiwan',
  'South Korean': 'South Korea',
  Indian: 'India',
  Pakistani: 'Pakistan',
  Indonesian: 'Indonesia',
  Thai: 'Thailand',
  Vietnamese: 'Vietnam',
  Filipino: 'Philippines',
  Iranian: 'Iran',
  Lebanese: 'Lebanon',
  Israeli: 'Israel',
  'South African': 'South Africa',
  Senegalese: 'Senegal',
  Malian: 'Mali',
  Nigerian: 'Nigeria',
  Ghanaian: 'Ghana',
  Ethiopian: 'Ethiopia',
  Kenyan: 'Kenya',
  Moroccan: 'Morocco',
  Algerian: 'Algeria',
  Tunisian: 'Tunisia',
  Egyptian: 'Egypt',
  Cameroonian: 'Cameroon',
  Angolan: 'Angola',
  Zimbabwean: 'Zimbabwe',
  Zambian: 'Zambia',
};
const aliases: Record<string, string> = {
  ...Object.fromEntries(Object.values(NATIONALITIES).map((country) => [country, country])),
  USA: 'United States',
  US: 'United States',
  UK: 'United Kingdom',
  England: 'United Kingdom',
  Scotland: 'United Kingdom',
  Wales: 'United Kingdom',
};

export function parseDiscogsOrigin(profile: string): string[] {
  const opening =
    profile
      .replace(/\[(?:\/?[bi])\]/gi, '')
      .trim()
      .split(/[\r\n]/)[0] ?? '';
  // Anchored to the artist's own introductory description, never a later sentence.
  for (const [adjective, country] of Object.entries(NATIONALITIES)) {
    if (
      new RegExp(
        `^(?:An? )?${adjective} (?:singer|songwriter|musician|composer|pianist|guitarist|bassist|drummer|percussionist|saxophonist|trumpeter|rapper|DJ|producer|band|group|duo|trio|quartet|quintet|ensemble|orchestra|collective)\\b`,
        'i',
      ).test(opening)
    ) {
      const birth = opening.match(/\bborn\b.*$/i);
      return birth ? parseDiscogsOrigin(birth[0]) : [country];
    }
  }
  // Named introductions, e.g. "BCUC (...) is a band from Soweto, South Africa ...".
  // Require an explicit musical role followed by "from", before any other sentence.
  const from = opening
    .split(/[.!?]/)[0]
    ?.match(
      /^(?:[^.;!?]{1,120} (?:is|are) )?(?:an? )?(?:band|group|duo|trio|quartet|ensemble|orchestra|collective|singer|musician) from ([^.;!?]+)$/i,
    );
  if (from) {
    const place = from[1]!.split(/\s+(?:that|which|who|formed|founded)\b/i)[0]!.trim();
    const country = Object.entries(aliases).find(([alias]) =>
      new RegExp(`(?:^|, )${alias}$`, 'i').test(place),
    );
    if (country) return [country[1]];
  }
  // A standalone first birth/formation clause; do not scan the rest of the biography.
  if (!/^(?:born\b|(?:band |group )?(?:formed|founded)\b)/i.test(opening)) return [];
  const clause = opening.split(/[.;]/)[0]!;
  if (/\b(?:moved|raised|based|relocated|parents|father|mother|but)\b/i.test(clause)) return [];
  const match = Object.entries(aliases).find(([alias]) =>
    new RegExp(`(?:^|[ ,(])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\))?$`, 'i').test(
      clause.trim(),
    ),
  );
  return match ? [match[1]] : [];
}

export async function lookupDiscogsOrigin(id: string): Promise<ArtistOrigin> {
  try {
    const artist = await getDiscogsArtist(id);
    if (String(artist.id) !== id) throw new Error('Discogs artist identity mismatch');
    const countries = parseDiscogsOrigin(artist.profile);
    return {
      countries,
      sourceUrl: countries.length ? `https://www.discogs.com/artist/${id}` : null,
    };
  } catch (error) {
    if (error instanceof DiscogsApiError && error.status === 404)
      return { countries: [], sourceUrl: null };
    throw error;
  }
}
