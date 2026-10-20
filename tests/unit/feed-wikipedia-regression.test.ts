import { describe, expect, it } from 'vitest';
import extracts from '../fixtures/feed/wikipedia-extracts.json';
import { selectWikipediaAnecdotes } from '@/modules/feed/anecdotes';

// Frozen excerpts with attribution: never perform network calls in these regressions.
describe('paragraphes Wikipédia confrontés au fil réel', () => {
  for (const fixture of extracts) {
    it(`retrouve un récit musical dans ${fixture.title}`, () => {
      const [story] = selectWikipediaAnecdotes(fixture.extract, 'artist', 'fr');
      expect(story).toBeDefined();
      expect(story!.score).toBeGreaterThanOrEqual(26);
      expect(fixture.extract).toContain(story!.text);
      expect(story!.text).not.toMatch(/Sgt\.$/);
      if (fixture.title === 'Bernard Lavilliers') {
        expect(story!.text).toMatch(/^L'une de ses chansons/);
        expect(story!.text).not.toContain('Toujours inspiré');
      }
    });
  }
});
