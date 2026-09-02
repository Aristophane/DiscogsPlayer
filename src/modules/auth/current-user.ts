/**
 * Accès à l'utilisateur courant depuis un composant serveur ou une route (§18.5).
 *
 * C'est la seule source autorisée d'un `user_id` : toute requête portant sur des données
 * utilisateur filtre par cette valeur, jamais par un paramètre venu du client.
 */
import { cookies } from 'next/headers';

import { ApiError } from '@/lib/api-error';

import { SESSION_COOKIE_NAME, resolveSession, type SessionUser } from './sessions';

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return resolveSession(token);
}

/** Variante pour les routes API : lève une erreur au format §17.8. */
export async function requireUser(): Promise<SessionUser> {
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

export async function requireAdmin(): Promise<SessionUser> {
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
