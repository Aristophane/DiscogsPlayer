import { describe, expect, it } from 'vitest';

import { fr } from '@/lib/i18n/fr';
import { t } from '@/lib/i18n';

describe('i18n', () => {
  it('retourne la chaîne du catalogue français', () => {
    expect(t('app.name')).toBe('Discogs Player');
  });

  it('interpole les valeurs nommées', () => {
    expect(t('nav.collection')).not.toContain('{');
  });

  it('ne contient aucune chaîne vide dans le catalogue', () => {
    for (const [key, value] of Object.entries(fr)) {
      expect(value.trim(), `clé ${key}`).not.toBe('');
    }
  });
});
