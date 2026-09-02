import Link from 'next/link';

import { t } from '@/lib/i18n';
import type { CollectionItem } from '@/modules/collection/service';
import { PlayButton } from '@/modules/playback/components/play-button';

import { coverProxyUrl } from '../cover';

import { AlbumCover } from './album-cover';

/**
 * Tuile d'album (§7.3).
 *
 * La pochette occupe la majorité de la tuile ; ni prix, ni statistiques, ni information de
 * marché. Le ratio carré est réservé avant chargement pour que la grille ne saute pas
 * (CLS < 0,1, §20.1).
 */
export function AlbumTile({ item, priority }: { item: CollectionItem; priority: boolean }) {
  const cover = coverProxyUrl(item.coverUrl);

  return (
    <li>
      <Link
        href={`/sorties/${item.discogsReleaseId}`}
        className="group flex flex-col gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current"
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-md bg-surface">
          <AlbumCover
            src={cover}
            title={item.title}
            artists={item.artists}
            eager={priority}
            className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
          />

          {item.instanceCount > 1 ? (
            // COLL-006 : information discrète, sans effet sur la probabilité de tirage.
            <span className="absolute right-1 top-1 rounded bg-background/90 px-1.5 py-0.5 text-xs font-medium">
              ×{item.instanceCount}
              <span className="sr-only">
                {' '}
                {t('collection.copies', { count: item.instanceCount })}
              </span>
            </span>
          ) : null}

          {/* Lit la première piste de l'album — friction minimale entre choisir et écouter. */}
          <PlayButton
            kind="album"
            id={item.discogsReleaseId}
            className="absolute bottom-1.5 right-1.5 opacity-90 shadow-sm"
          />
        </div>

        <div className="flex flex-col">
          {/* Deux lignes maximum sous la pochette (§7.3). */}
          <span className="line-clamp-2 text-sm font-medium leading-tight">{item.title}</span>
          <span className="line-clamp-2 text-xs leading-tight text-muted">{item.artists}</span>
        </div>
      </Link>
    </li>
  );
}
