import Link from 'next/link';
import { t } from '@/lib/i18n';
import { getFriendsActivity } from '../service';
import { coverProxyUrl } from '../cover';
import { AlbumCover } from './album-cover';
import { PersonalReleaseLink } from './personal-release-link';

const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Paris',
});

export async function FriendsActivity({
  userId,
  activeOwnerId,
}: {
  userId: string;
  activeOwnerId: string;
}) {
  const items = await getFriendsActivity(userId);
  return (
    <section aria-labelledby="friends-activity" className="min-w-0">
      <h2 id="friends-activity" className="text-xl font-semibold tracking-tight">
        {t('home.activity.title')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('home.activity.description')}</p>
      {items.length === 0 ? (
        <p className="py-6 text-sm leading-relaxed text-muted">{t('home.activity.empty')}</p>
      ) : (
        <ol className="mt-4 divide-y divide-border">
          {items.map((item) => (
            <li key={`${item.ownerId}:${item.discogsReleaseId}`} className="py-4">
              <p className="mb-2 text-xs text-muted">
                {t('home.activity.added', { username: item.ownerUsername })}
              </p>
              <PersonalReleaseLink
                releaseId={item.discogsReleaseId}
                ownerId={item.ownerId}
                switchToOwn={activeOwnerId !== item.ownerId}
              >
                <div className="relative aspect-square w-32 shrink-0 overflow-hidden rounded-md bg-surface sm:w-40">
                  <AlbumCover
                    src={coverProxyUrl(item.coverUrl)}
                    title={item.title}
                    artists={item.artists}
                  />
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-medium">{item.title}</p>
                  <p className="line-clamp-1 text-xs text-muted">{item.artists}</p>
                  <p className="mt-1 text-xs text-muted">
                    {item.addedAt ? (
                      <time dateTime={new Date(item.addedAt).toISOString()}>
                        {dateFormat.format(new Date(item.addedAt))}
                      </time>
                    ) : (
                      t('home.activity.unknownDate')
                    )}
                  </p>
                </div>
              </PersonalReleaseLink>
            </li>
          ))}
        </ol>
      )}
      <Link href="/amis" className="mt-3 inline-block text-sm underline underline-offset-4">
        {t('home.activity.friends')}
      </Link>
    </section>
  );
}
