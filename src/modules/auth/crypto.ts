/**
 * Chiffrement applicatif des secrets fournisseur (SPECIFICATION.md §18.1, AUTH-005).
 *
 * AES-256-GCM : confidentialité et authentification en une seule primitive. Le format de
 * sortie porte sa version de clé, ce qui rend la rotation possible sans déchiffrer toute
 * la base d'un coup (§10.1 `encryption_key_version`).
 *
 * Format : `v{version}.{iv}.{tag}.{ciphertext}`, chaque partie en base64url.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

import { getEnv } from '@/lib/env';

const ALGORITHM = 'aes-256-gcm';
/** 96 bits : longueur recommandée pour GCM, jamais réutilisée pour une même clé. */
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export type EncryptedSecret = {
  ciphertext: string;
  keyVersion: number;
};

function keyFor(version: number): Buffer {
  const env = getEnv();

  if (version !== env.CREDENTIAL_ENCRYPTION_KEY_VERSION) {
    // Une rotation introduira ici la lecture des clés précédentes ; tant qu'aucune
    // n'a eu lieu, échouer est préférable à déchiffrer avec la mauvaise clé.
    throw new Error(
      `Aucune clé de chiffrement disponible pour la version ${version} (courante : ${env.CREDENTIAL_ENCRYPTION_KEY_VERSION})`,
    );
  }

  return Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY, 'base64');
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const keyVersion = getEnv().CREDENTIAL_ENCRYPTION_KEY_VERSION;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyFor(keyVersion), iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const parts = [
    `v${keyVersion}`,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ];

  return { ciphertext: parts.join('.'), keyVersion };
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');

  if (parts.length !== 4) {
    throw new Error('Format de secret chiffré invalide');
  }

  const [versionPart, ivPart, tagPart, dataPart] = parts as [string, string, string, string];

  if (!versionPart.startsWith('v')) {
    throw new Error('Format de secret chiffré invalide');
  }

  const keyVersion = Number(versionPart.slice(1));
  if (!Number.isInteger(keyVersion) || keyVersion < 1) {
    throw new Error('Version de clé invalide');
  }

  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');

  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error('Format de secret chiffré invalide');
  }

  const decipher = createDecipheriv(ALGORITHM, keyFor(keyVersion), iv);
  decipher.setAuthTag(tag);

  // `final()` lève si le tag ne correspond pas : toute altération est détectée.
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Comparaison à temps constant de deux chaînes (jetons, hachés). */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}
