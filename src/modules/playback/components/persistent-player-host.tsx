'use client';

/**
 * Hôte du lecteur persistant (SPEC-GAPS G-17).
 *
 * Ce composant est monté dans le layout racine et n'est jamais démonté lors d'une
 * navigation : c'est la seule position où un <iframe> YouTube ou Spotify survit à un
 * changement de route. La route `/lecture` (§7.1) n'en sera qu'une vue étendue, pas le
 * point de montage.
 *
 * Lot 0 : la coquille existe pour verrouiller l'architecture. La file, les lecteurs
 * fournisseurs et les événements arrivent aux lots 6 à 8.
 */
export function PersistentPlayerHost() {
  return null;
}
