import Link from 'next/link';
import { t } from '@/lib/i18n';
import { getFriendsActivity } from '../service';
import { coverProxyUrl } from '../cover';
import { AlbumCover } from './album-cover';
import { PersonalReleaseLink } from './personal-release-link';
import { FriendAdditionsLink } from '@/modules/sharing/components/friend-additions-link';

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
        <ol className="mt-5 grid grid-cols-2 items-start gap-x-4 gap-y-6 lg:grid-cols-3">
          {items.map((item) => (
            <li key={`${item.ownerId}:${item.discogsReleaseId}`} className="min-w-0">
              <p className="mb-2 text-xs text-muted">
                {t('home.activity.added', { username: item.ownerUsername })}
              </p>
              <PersonalReleaseLink
                releaseId={item.discogsReleaseId}
                ownerId={item.ownerId}
                switchToOwn={activeOwnerId !== item.ownerId}
                layout="cover"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-md bg-surface">
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
              <FriendAdditionsLink
                ownerId={item.ownerId}
                username={item.ownerUsername}
                active={activeOwnerId === item.ownerId}
              />
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
