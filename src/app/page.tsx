import Link from 'next/link';

import { t } from '@/lib/i18n';
import { Logo } from '@/lib/ui/logo';
import { getCurrentUser } from '@/modules/auth/current-user';
import { SpotifyPreferenceToggle } from '@/modules/auth/components/spotify-preference';
import { getCollectionHighlights } from '@/modules/collection/service';
import { CollectionHighlights } from '@/modules/collection/components/collection-highlights';
import { FriendsActivity } from '@/modules/collection/components/friends-activity';
import { RandomSpotlight } from '@/modules/collection/components/random-spotlight';
import { requestCollectionStatisticsRefresh } from '@/modules/sync/service';
import { ViewingAsBanner } from '@/modules/sharing/components/viewing-as-banner';

/** Accueil : découvertes, actualités des amis et tops de la collection affichée. */
export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-16">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{t('app.name')}</h1>
            <p className="text-sm text-muted">{t('app.subtitle')}</p>
          </div>
        </div>
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

  const highlights = await getCollectionHighlights(user.activeCollectionOwnerId);
  await requestCollectionStatisticsRefresh(user.activeCollectionOwnerId);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('home.hub.title')}</h1>

      {/* Onboarding facultatif (ADR-0006) : disparaît dès qu'une réponse est donnée,
          rejouable ensuite depuis les paramètres. */}
      <SpotifyPreferenceToggle initial={user.spotifyEnabled} variant="onboarding" />

      {user.activeCollectionOwner ? (
        <ViewingAsBanner ownerUsername={user.activeCollectionOwner.username} />
      ) : null}

      <div className="grid items-start gap-10 border-t border-border pt-8 md:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)]">
        <FriendsActivity userId={user.id} activeOwnerId={user.activeCollectionOwnerId} />
        <RandomSpotlight
          key={user.activeCollectionOwnerId}
          ownerId={user.activeCollectionOwnerId}
        />
      </div>

      <CollectionHighlights
        key={user.activeCollectionOwnerId}
        initial={highlights}
        ownerUsername={user.activeCollectionOwner?.username ?? null}
      />
    </main>
  );
}
