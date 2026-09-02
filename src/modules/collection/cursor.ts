/**
 * Pagination par curseur (SPECIFICATION.md §17.3, SPEC-GAPS G-15).
 *
 * Un curseur encode la position exacte dans l'ordre courant : contrairement à un `offset`,
 * il ne saute ni ne duplique d'élément quand la collection change entre deux pages.
 *
 * Le format est opaque pour le client, mais volontairement lisible côté serveur : c'est
 * une position, pas un secret — il ne contient jamais d'identifiant d'utilisateur.
 */
import { z } from 'zod';

export const SORT_OPTIONS = ['date_added_desc', 'artist_asc', 'title_asc', 'year_desc'] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];
export const DEFAULT_SORT: SortOption = 'date_added_desc';

const cursorSchema = z.object({
  /** Valeur de la clé de tri du dernier élément rendu. `null` = valeur absente en base. */
  k: z.union([z.string(), z.number(), z.null()]),
  /** Identifiant du dernier élément : départage les ex æquo et rend l'ordre total. */
  i: z.string().uuid(),
  s: z.enum(SORT_OPTIONS),
});

export type Cursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/**
 * Décode un curseur. Retourne `null` pour toute valeur illisible plutôt que de lever :
 * un curseur périmé ou tronqué doit ramener à la première page, pas produire une erreur.
 */
export function decodeCursor(raw: string | null | undefined, sort: SortOption): Cursor | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')),
    );

    if (!parsed.success) {
      return null;
    }

    // Un curseur émis pour un autre tri n'a aucun sens dans l'ordre courant.
    return parsed.data.s === sort ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseSort(raw: string | null | undefined): SortOption {
  const parsed = z.enum(SORT_OPTIONS).safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SORT;
}
