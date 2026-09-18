import { t } from '@/lib/i18n';

const countFormat = new Intl.NumberFormat('fr-FR');

export function CommunityStats({ have, want }: { have: number | null; want: number | null }) {
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs leading-relaxed text-muted">
      {(
        [
          { label: 'statistics.have', value: have },
          { label: 'statistics.want', value: want },
        ] as const
      ).map(({ label, value }) => (
        <div key={label} className="flex flex-wrap items-baseline gap-x-1">
          <dt>{t(label)}</dt>
          <dd className="font-medium tabular-nums text-foreground">
            {value == null ? (
              <span title={t('statistics.unavailable')} aria-label={t('statistics.unavailable')}>
                —
              </span>
            ) : (
              countFormat.format(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
