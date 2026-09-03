import Link from 'next/link';

import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';
import { SpotifyPreferenceToggle } from '@/modules/auth/components/spotify-preference';
import { countCollection } from '@/modules/collection/service';
import { ViewingAsBanner } from '@/modules/sharing/components/viewing-as-banner';

/**
 * Accueil (§7.1 `/`).
 *
 * Un utilisateur connecté arrive sur trois portes d'entrée plutôt que directement sur la
 * grille (ADR-0006) : l'objectif est de réduire la distance entre l'envie d'écouter et la
 * lecture. Un visiteur non connecté voit la page publique.
 */
export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">{t('app.name')}</h1>
        <p className="text-lg text-muted">{t('app.tagline')}</p>
        <p className="text-sm text-muted">{t('home.intro')}</p>
        <Link
          href="/connexion"
          className="self-start rounded-md bg-foreground px-5 py-3 font-medium text-background"
        >
          {t('home.signIn')}
        </Link>
      </main>
    );
  }

  const count = await countCollection(user.activeCollectionOwnerId);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('home.hub.title')}</h1>

      {/* Onboarding facultatif (ADR-0006) : disparaît dès qu'une réponse est donnée,
          rejouable ensuite depuis les paramètres. */}
      <SpotifyPreferenceToggle initial={user.spotifyEnabled} variant="onboarding" />

      {user.activeCollectionOwner ? (
        <ViewingAsBanner ownerUsername={user.activeCollectionOwner.username} />
      ) : null}

      <nav className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <HubTile
          href="/collection"
          icon="▦"
          label={t('home.hub.collection')}
          hint={t('home.hub.collection.hint', { count })}
        />
        <HubTile
          href="/aleatoire"
          icon="⤫"
          label={t('home.hub.random')}
          hint={t('home.hub.random.hint')}
        />
        <HubTile
          href="/radio"
          icon="◎"
          label={t('home.hub.radio')}
          hint={t('home.hub.radio.hint')}
        />
      </nav>

      <Link href="/parametres" className="text-sm underline">
        {t('nav.settings')}
      </Link>
    </main>
  );
}

/**
 * `next/link`, jamais un `<a>` brut (§SPEC-GAPS G-17) : une ancre classique déclenche une
 * navigation plein document, qui démonte tout le layout racine — le lecteur persistant y
 * compris — avant de tout remonter à vide. Défaut réel constaté en cliquant sur la tuile
 * Radio pendant une lecture en cours : le lecteur disparaissait purement et simplement au
 * lieu de continuer en arrière-plan (2026-09-03).
 */
function HubTile({
  href,
  icon,
  label,
  hint,
  disabledHint,
}: {
  href?: string;
  icon: string;
  label: string;
  hint: string;
  disabledHint?: string;
}) {
  const content = (
    <>
      <span aria-hidden="true" className="text-3xl">
        {icon}
      </span>
      <span className="text-lg font-medium">{label}</span>
      <span className="text-sm text-muted">{disabledHint ?? hint}</span>
    </>
  );

  const shape =
    'flex min-h-36 flex-col items-start justify-center gap-1 rounded-lg border border-border p-5';

  if (!href) {
    return (
      // Une entrée indisponible reste visible et annoncée comme telle, plutôt que masquée :
      // l'utilisateur sait ce qui viendra (§20.2, la couleur n'est pas le seul indicateur).
      <div className={`${shape} opacity-60`} aria-disabled="true">
        {content}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={`${shape} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current`}
    >
      {content}
    </Link>
  );
}
