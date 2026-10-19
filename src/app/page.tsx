import Link from 'next/link';

import { t } from '@/lib/i18n';
import { Logo } from '@/lib/ui/logo';
import { getCurrentUser } from '@/modules/auth/current-user';
import { ensureDailyFeed, getFeedPage } from '@/modules/feed/service';
import { HomeFeed } from '@/modules/feed/components/home-feed';

/** Accueil : publications des collections personnelles et partagées. */
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

  await ensureDailyFeed(user.id);
  const feed = await getFeedPage(user.id);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 pb-12 sm:border-x sm:border-border">
      <h1 className="sr-only">{t('feed.title')}</h1>
      <HomeFeed
        key={user.id}
        userId={user.id}
        initial={feed}
        activeOwnerId={user.activeCollectionOwnerId}
      />
    </main>
  );
}
