import { describe, expect, it, vi } from 'vitest';
import { fetchWikipediaStory } from '@/modules/feed/sources';

// All HTTP responses below are synthetic; never contact a real provider in tests.
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ PROVIDERS_MODE: 'live', DISCOGS_USER_AGENT: 'DiscogsPlayer tests' }),
}));
const biography =
  'Orbite est un groupe de rock français fondé à Paris. Ses membres ont publié plusieurs albums et effectué des tournées en Europe.';
const anecdote =
  'Pendant l’enregistrement du disque, une panne de courant interrompt la séance. Le groupe décide de conserver le bruit de cet accident sur la bande et en fait le début du morceau.';
const english =
  'During the recording session, a power failure accidentally stopped the tape machine. The band decided to keep the strange sound of the accident and used it as the opening of the song.';
const identities = () =>
  Response.json({
    results: {
      bindings: ['fr', 'en'].map((language) => ({
        entity: { value: 'http://www.wikidata.org/entity/Q1' },
        article: { value: `https://${language}.wikipedia.org/wiki/Orbite` },
      })),
    },
  });
const article = (extract: string) =>
  Response.json({
    query: {
      rightsinfo: { url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      pages: [{ title: 'Orbite', lastrevid: 123, extract }],
    },
  });

describe('récupération Wikipédia et sélection éditoriale', () => {
  it('lit les sections complètes en français et conserve révision et licence', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(identities())
      .mockResolvedValueOnce(article(`${biography}\n\n== Enregistrement ==\n\n${anecdote}`));
    const stories = await fetchWikipediaStory({ kind: 'artist', id: '12345' }, fetcher);
    expect(stories).toHaveLength(1);
    expect(stories[0]).toMatchObject({
      kind: 'artist',
      text: anecdote,
      language: 'fr',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      editorial: { version: 1, topic: 'recording', section: 'Enregistrement' },
    });
    expect(stories[0]!.sourceUrl).toBe(
      'https://fr.wikipedia.org/w/index.php?title=Orbite&oldid=123',
    );
    const query = new URL(String(fetcher.mock.calls[1]![0]));
    expect(query.searchParams.get('exsectionformat')).toBe('wiki');
    expect(query.searchParams.has('exintro')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]![1]?.headers).toHaveProperty('User-Agent');
  });

  it('passe à l’article anglais si le français ne fournit pas d’anecdote', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(identities())
      .mockResolvedValueOnce(article(biography))
      .mockResolvedValueOnce(article(`== Recording ==\n\n${english}`));
    const stories = await fetchWikipediaStory({ kind: 'album', id: '12345' }, fetcher);
    expect(stories[0]).toMatchObject({
      text: english,
      language: 'en',
      editorial: { topic: 'recording' },
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('ne transforme pas une erreur fournisseur en absence d’anecdote', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(identities())
      .mockResolvedValueOnce(new Response('busy', { status: 503 }));
    await expect(fetchWikipediaStory({ kind: 'artist', id: '12345' }, fetcher)).rejects.toThrow(
      'Feed source unavailable',
    );
  });

  it('refuse ports alternatifs, identités ambiguës et identifiants malformés', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        results: {
          bindings: [
            {
              entity: { value: 'http://www.wikidata.org/entity/Q1' },
              article: { value: 'https://fr.wikipedia.org:8443/wiki/Orbite' },
            },
          ],
        },
      }),
    );
    expect(await fetchWikipediaStory({ kind: 'artist', id: '12345' }, fetcher)).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    expect(await fetchWikipediaStory({ kind: 'artist', id: '12" UNION {}' }, fetcher)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
