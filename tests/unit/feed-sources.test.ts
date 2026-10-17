import { describe, expect, it } from 'vitest';
import { feedDay } from '@/modules/feed/contracts';
import {
  newsMentionsArtist,
  NEWS_SOURCES,
  parseNewsRss,
  selectWikipediaExcerpt,
  wikipediaArticles,
} from '@/modules/feed/sources';

describe('sources du fil', () => {
  it('résout une identité Discogs exacte et privilégie Wikipédia en français', () => {
    const binding = (entity: string, article: string) => ({
      entity: { value: `http://www.wikidata.org/entity/${entity}` },
      article: { value: article },
    });
    const rows = [
      binding('Q1', 'https://en.wikipedia.org/wiki/Example'),
      binding('Q1', 'https://fr.wikipedia.org/wiki/Exemple'),
    ];
    expect(wikipediaArticles({ results: { bindings: rows } })[0]?.hostname).toBe(
      'fr.wikipedia.org',
    );
    expect(
      wikipediaArticles({
        results: { bindings: [...rows, binding('Q2', 'https://fr.wikipedia.org/wiki/Autre')] },
      }),
    ).toEqual([]);
    expect(
      wikipediaArticles({ results: { bindings: [binding('Q1', 'https://evil.test/wiki/A')] } }),
    ).toEqual([]);
  });

  it('retient un paragraphe d’enregistrement sans inventer une anecdote', () => {
    const intro = 'Cet album est une œuvre musicale. '.repeat(5);
    const studio = 'Les séances en studio ont eu lieu en janvier avec plusieurs musiciens. '.repeat(
      4,
    );
    expect(selectWikipediaExcerpt(`${intro}\n\n${studio}`, 'album')).toBe(studio.trim());
    expect(selectWikipediaExcerpt(`${intro}\n\n${studio}`, 'artist')).toBe(intro.trim());
  });

  it('ne rapproche pas les artistes par sous-chaîne ou nom trop ambigu', () => {
    expect(newsMentionsArtist('Björk annonce un nouvel album', 'Björk (2)')).toBe(true);
    expect(newsMentionsArtist('Les Radioheadlines du jour', 'Radiohead')).toBe(false);
    expect(newsMentionsArtist('Air France lance un service', 'Air')).toBe(false);
  });

  it('parse les titres RSS, refuse liens externes, dates absentes et entités externes', () => {
    const now = new Date('2026-10-17T12:00:00Z');
    const item = (url: string, date = 'Sat, 17 Oct 2026 10:00:00 GMT') =>
      `<item><title><![CDATA[Björk &amp; ses musiciens]]></title><link>${url}</link><pubDate>${date}</pubDate><description><![CDATA[<p>Un concert &amp; une interview.</p>]]></description></item>`;
    const xml = `<rss><channel>${item('https://www.lemonde.fr/musiques/article/1')}${item('https://evil.test/a')}${item('https://www.lemonde.fr/a', '')}</channel></rss>`;
    const parsed = parseNewsRss(xml, NEWS_SOURCES[0]!, now);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe('Björk & ses musiciens');
    expect(parsed[0]?.text).toBe('Un concert & une interview.');
    expect(() =>
      parseNewsRss('<!DOCTYPE rss SYSTEM "file:///secret"><rss></rss>', NEWS_SOURCES[0]!, now),
    ).toThrow();
    expect(() => parseNewsRss('<html>erreur fournisseur</html>', NEWS_SOURCES[0]!, now)).toThrow();
  });

  it('change de sélection à minuit en France, y compris en heure d’été', () => {
    expect(feedDay(new Date('2026-07-01T22:01:00Z'))).toBe('2026-07-02');
    expect(feedDay(new Date('2026-01-01T22:01:00Z'))).toBe('2026-01-01');
  });
});
