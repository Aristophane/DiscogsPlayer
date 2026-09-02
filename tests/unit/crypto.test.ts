import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, safeEqual } from '@/modules/auth/crypto';

describe('chiffrement des credentials (AUTH-005)', () => {
  it('restitue le clair après un aller-retour', () => {
    const secret = 'oauth-token-secret-discogs';
    const { ciphertext } = encryptSecret(secret);

    expect(decryptSecret(ciphertext)).toBe(secret);
  });

  it('ne laisse jamais apparaître le clair dans le chiffré', () => {
    const secret = 'valeur-tres-reconnaissable';
    const { ciphertext } = encryptSecret(secret);

    expect(ciphertext).not.toContain(secret);
    expect(Buffer.from(ciphertext, 'utf8').includes(secret)).toBe(false);
  });

  it('produit un chiffré différent à chaque appel (IV aléatoire)', () => {
    const a = encryptSecret('identique').ciphertext;
    const b = encryptSecret('identique').ciphertext;

    // Deux IV identiques sur une même clé casseraient GCM.
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('porte la version de clé, pour permettre la rotation (§10.1)', () => {
    const { ciphertext, keyVersion } = encryptSecret('x');

    expect(keyVersion).toBe(1);
    expect(ciphertext.startsWith('v1.')).toBe(true);
  });

  it('rejette un chiffré altéré au lieu de renvoyer des octets faux', () => {
    const { ciphertext } = encryptSecret('secret');
    const parts = ciphertext.split('.');
    const data = Buffer.from(parts[3] as string, 'base64url');
    data[0] = (data[0] ?? 0) ^ 0xff;
    parts[3] = data.toString('base64url');

    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });

  it('rejette un tag d’authentification altéré', () => {
    const { ciphertext } = encryptSecret('secret');
    const parts = ciphertext.split('.');
    const tag = Buffer.from(parts[2] as string, 'base64url');
    tag[0] = (tag[0] ?? 0) ^ 0xff;
    parts[2] = tag.toString('base64url');

    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });

  it('rejette une version de clé inconnue plutôt que de deviner', () => {
    const { ciphertext } = encryptSecret('secret');
    const parts = ciphertext.split('.');
    parts[0] = 'v9';

    expect(() => decryptSecret(parts.join('.'))).toThrow(/version 9/);
  });

  it('rejette un format invalide', () => {
    expect(() => decryptSecret('nimporte-quoi')).toThrow(/invalide/);
    expect(() => decryptSecret('v1.a.b')).toThrow(/invalide/);
  });
});

describe('safeEqual', () => {
  it('compare correctement', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
