import { t } from '@/lib/i18n';

const averageFormat = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function CommunityRating({
  average,
  count,
}: {
  average: number | null;
  count: number | null;
}) {
  const rated = average !== null && average > 0 && count !== null && count > 0;
  return (
    <div className="text-sm">
      <p className="text-xs text-muted">{t('rating.community')}</p>
      {rated ? (
        <>
          <p className="mt-1 font-semibold tabular-nums">
            <span aria-hidden="true">★ </span>
            {t('rating.value', { average: averageFormat.format(average) })}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t(count === 1 ? 'rating.vote' : 'rating.votes', {
              count: count.toLocaleString('fr-FR'),
            })}
          </p>
        </>
      ) : (
        <p className="mt-1 text-muted">
          {t(count === 0 ? 'rating.noVotes' : 'rating.unavailable')}
        </p>
      )}
    </div>
  );
}
