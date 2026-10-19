import { z } from 'zod';
import { getEnv } from '@/lib/env';
import { normalizeText } from '@/modules/catalog/normalize';
import { sourceStorySchema, type SourceStory } from './contracts';
import { ANECDOTE_VERSION, selectWikipediaAnecdotes } from './anecdotes';

const bindingsSchema = z.object({
  results: z.object({
    bindings: z.array(
      z.object({
        entity: z.object({
          value: z.string().regex(/^https?:\/\/www\.wikidata\.org\/entity\/Q\d+$/),
        }),
        article: z.object({ value: z.string().url() }),
      }),
    ),
  }),
});
const extractSchema = z.object({
  query: z.object({
    rightsinfo: z.object({ url: z.string().url() }),
    pages: z.array(
      z.object({
        title: z.string(),
        extract: z.string().optional(),
        lastrevid: z.number().int().optional(),
      }),
    ),
  }),
});

/** Lecture bornée et aucune redirection vers un serveur non contrôlé. */
async function fetchText(url: URL, fetcher: typeof fetch, maxBytes = 1_500_000): Promise<string> {
  const response = await fetcher(url, {
    headers: {
      'User-Agent': getEnv().DISCOGS_USER_AGENT,
      Accept: 'application/json, application/rss+xml, application/xml',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok || !response.body) throw new Error('Feed source unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maxBytes) throw new Error('Feed source too large');
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel();
  }
}

/** L'identité vient de l'identifiant Discogs exact, jamais d'une recherche approximative par nom. */
export function wikipediaArticles(value: unknown): URL[] {
  const bindings = bindingsSchema.parse(value).results.bindings;
  if (new Set(bindings.map(({ entity }) => entity.value.replace(/^http:/, 'https:'))).size !== 1)
    return [];
  return bindings
    .map(({ article }) => new URL(article.value))
    .filter(
      (url) =>
        url.protocol === 'https:' &&
        ['fr.wikipedia.org', 'en.wikipedia.org'].includes(url.hostname) &&
        !url.port &&
        url.pathname.startsWith('/wiki/') &&
        !url.username &&
        !url.password,
    )
    .sort((a, b) => Number(b.hostname.startsWith('fr.')) - Number(a.hostname.startsWith('fr.')));
}

export function selectWikipediaExcerpt(text: string, kind: 'album' | 'artist'): string {
  return selectWikipediaAnecdotes(text, kind)[0]?.text ?? '';
}

export async function fetchWikipediaStory(
  subject: { kind: 'album' | 'artist'; id: string },
  fetcher: typeof fetch = fetch,
): Promise<SourceStory[]> {
  if (getEnv().PROVIDERS_MODE === 'fixtures') return [];
  if (!/^[1-9]\d*$/.test(subject.id)) return [];
  const property = subject.kind === 'artist' ? 'P1953' : 'P1954';
  const query = `SELECT DISTINCT ?entity ?article WHERE {
    ?entity <http://www.wikidata.org/prop/direct/${property}> "${subject.id}" .
    ?article <http://schema.org/about> ?entity ; <http://schema.org/isPartOf> ?site .
    VALUES ?site { <https://fr.wikipedia.org/> <https://en.wikipedia.org/> }
  } LIMIT 10`;
  const endpoint = new URL('https://query.wikidata.org/sparql');
  endpoint.search = new URLSearchParams({ query, format: 'json' }).toString();
  const articles = wikipediaArticles(JSON.parse(await fetchText(endpoint, fetcher)));
  for (const article of articles) {
    const title = decodeURIComponent(article.pathname.slice('/wiki/'.length));
    const url = new URL('/w/api.php', article.origin);
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'extracts|info',
      titles: title,
      explaintext: '1',
      exsectionformat: 'wiki',
      meta: 'siteinfo',
      siprop: 'rightsinfo',
      redirects: '1',
    }).toString();
    const result = extractSchema.parse(JSON.parse(await fetchText(url, fetcher)));
    const page = result.query.pages[0];
    const language = article.hostname.startsWith('fr.') ? ('fr' as const) : ('en' as const);
    const anecdotes = selectWikipediaAnecdotes(page?.extract ?? '', subject.kind, language);
    if (!page || !anecdotes.length) continue;
    // Le permalien conserve la révision de l'extrait, et la licence vient du site.
    const source = new URL('/w/index.php', article.origin);
    source.search = new URLSearchParams({
      title: page.title,
      ...(page.lastrevid ? { oldid: String(page.lastrevid) } : {}),
    }).toString();
    return anecdotes.map((anecdote) =>
      sourceStorySchema.parse({
        kind: subject.kind,
        title: page.title,
        text: anecdote.text,
        sourceName: 'Wikipédia',
        sourceUrl: source.toString(),
        language,
        publishedAt: null,
        licenseUrl: result.query.rightsinfo.url.replace(/^http:/, 'https:'),
        editorial: {
          version: ANECDOTE_VERSION,
          score: anecdote.score,
          topic: anecdote.topic,
          section: anecdote.section,
        },
      }),
    );
  }
  return [];
}

export const NEWS_SOURCES = [
  {
    name: 'Le Monde · Musiques',
    url: 'https://www.lemonde.fr/musiques/rss_full.xml',
    host: 'www.lemonde.fr',
    language: 'fr' as const,
  },
  {
    name: 'The Guardian · Music',
    url: 'https://www.theguardian.com/music/rss',
    host: 'www.theguardian.com',
    language: 'en' as const,
  },
];

export function plainText(value: string): string {
  const text = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ');
  return text
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
      const number = code.toLowerCase().startsWith('#x')
        ? parseInt(code.slice(2), 16)
        : code.startsWith('#')
          ? Number(code.slice(1))
          : null;
      if (number !== null)
        return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
          ? String.fromCodePoint(number)
          : '';
      return (
        ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[
          code.toLowerCase()
        ] ?? entity
      );
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sous-ensemble RSS 2.0 ; pas de DTD ni d'entités externes, pas de HTML exécutable. */
export function parseNewsRss(
  xml: string,
  source: (typeof NEWS_SOURCES)[number],
  now = new Date(),
): SourceStory[] {
  if (!/<rss[\s>]/i.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('Invalid RSS feed');
  const tag = (item: string, name: string) =>
    plainText(
      item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '',
    );
  const stories: SourceStory[] = [];
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const item = match[1]!;
    const title = tag(item, 'title');
    const published = new Date(tag(item, 'pubDate'));
    if (
      !title ||
      title.length > 500 ||
      !Number.isFinite(published.getTime()) ||
      published.getTime() > now.getTime() + 3_600_000 ||
      published.getTime() < now.getTime() - 30 * 86_400_000
    )
      continue;
    let url: URL;
    try {
      url = new URL(tag(item, 'link'));
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || url.hostname !== source.host || url.username || url.password)
      continue;
    // Un titre et un court extrait du flux ; l'article complet reste chez l'éditeur.
    const description = tag(item, 'description').split(/\s+/).slice(0, 24).join(' ');
    stories.push(
      sourceStorySchema.parse({
        kind: 'news',
        title,
        text: description,
        sourceName: source.name,
        sourceUrl: url.toString(),
        language: source.language,
        publishedAt: published.toISOString(),
        licenseUrl: null,
      }),
    );
    if (stories.length >= 100) break;
  }
  return stories;
}

export async function fetchMusicNews(
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<SourceStory[]> {
  if (getEnv().PROVIDERS_MODE === 'fixtures') return [];
  const results = await Promise.allSettled(
    NEWS_SOURCES.map(async (source) =>
      parseNewsRss(await fetchText(new URL(source.url), fetcher), source, now),
    ),
  );
  if (results.every((result) => result.status === 'rejected'))
    throw new Error('Music news unavailable');
  return results
    .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    .sort(
      (a, b) =>
        Number(b.language === 'fr') - Number(a.language === 'fr') ||
        (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
    );
}

export function newsMentionsArtist(title: string, artist: string): boolean {
  const name = normalizeText(artist.replace(/ \(\d+\)$/, ''))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (name.length < 5 || name === 'various' || /^\d+$/.test(name)) return false;
  const headline = normalizeText(title).replace(/[^\p{L}\p{N}]+/gu, ' ');
  return ` ${headline} `.includes(` ${name} `);
}
