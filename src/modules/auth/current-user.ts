/**
 * Accès à l'utilisateur courant depuis un composant serveur ou une route (§18.5).
 *
 * C'est la seule source autorisée d'un `user_id` : toute requête portant sur des données
 * utilisateur filtre par cette valeur, jamais par un paramètre venu du client.
 */
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/db/schema';
import { ApiError } from '@/lib/api-error';
import { hasActiveGrant } from '@/modules/sharing/service';

import { SESSION_COOKIE_NAME, resolveSession, type SessionUser } from './sessions';

/**
 * `SessionUser` enrichi de la collection active (Lot 7, partage).
 *
 * `activeCollectionOwnerId` est ce que tout module scopé par utilisateur
 * (collection, fiche album, Radio, Aléatoire) doit désormais recevoir à la place de
 * `id` — c'est le seul changement que le partage doit leur imposer, par construction :
 * chacun continue de filtrer par un simple `user_id`, sans rien savoir du partage
 * lui-même. `id` reste la vraie identité : `sync` (import Discogs), les réglages du
 * compte et toute action d'écriture doivent continuer à utiliser `id`, jamais
 * `activeCollectionOwnerId` — consulter la collection d'un ami ne doit jamais permettre
 * de déclencher un import ou une action en son nom.
 */
export type CurrentUser = SessionUser & {
  activeCollectionOwnerId: string;
  /** Non nul seulement quand la collection active n'est pas la sienne. */
  activeCollectionOwner: { id: string; username: string } | null;
};

/**
 * Exportée pour être testée directement : la logique de sécurité qui compte (une
 * révocation prend effet immédiatement) n'a pas besoin de passer par un vrai cookie
 * `next/headers`, indisponible hors d'une requête Next.js.
 */
export async function resolveActiveCollection(
  sessionUser: SessionUser,
): Promise<Pick<CurrentUser, 'activeCollectionOwnerId' | 'activeCollectionOwner'>> {
  if (!sessionUser.viewingAsUserId) {
    return { activeCollectionOwnerId: sessionUser.id, activeCollectionOwner: null };
  }

  // Revérifié à chaque résolution, jamais pris pour argent comptant depuis la session :
  // une révocation doit prendre effet dès cette requête (§18.5), pas seulement à la
  // reconnexion. Le partage disparu (révoqué, ou le compte de l'ami supprimé) retombe
  // silencieusement sur sa propre collection plutôt que d'échouer la requête.
  const granted = await hasActiveGrant(sessionUser.viewingAsUserId, sessionUser.id);
  if (!granted) {
    return { activeCollectionOwnerId: sessionUser.id, activeCollectionOwner: null };
  }

  const [owner] = await db
    .select({ id: users.id, username: users.discogsUsername })
    .from(users)
    .where(eq(users.id, sessionUser.viewingAsUserId))
    .limit(1);

  if (!owner) {
    return { activeCollectionOwnerId: sessionUser.id, activeCollectionOwner: null };
  }

  return { activeCollectionOwnerId: owner.id, activeCollectionOwner: owner };
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const sessionUser = await resolveSession(token);
  if (!sessionUser) {
    return null;
  }

  const active = await resolveActiveCollection(sessionUser);
  return { ...sessionUser, ...active };
}

/** Variante pour les routes API : lève une erreur au format §17.8. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new ApiError({
      code: 'AUTH_REQUIRED',
      message: 'Connectez-vous pour accéder à cette ressource.',
      status: 401,
    });
  }

  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();

  if (user.role !== 'admin') {
    // Même code et même message qu'un utilisateur inexistant côté client : on ne
    // confirme pas l'existence d'une ressource d'administration.
    throw new ApiError({
      code: 'FORBIDDEN',
      message: 'Vous n’avez pas accès à cette ressource.',
      status: 403,
    });
  }

  return user;
}
