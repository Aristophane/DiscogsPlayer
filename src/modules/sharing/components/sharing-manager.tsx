'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { t } from '@/lib/i18n';

type Grant = { createdAt: string };
type GivenGrant = Grant & { granteeId: string; granteeUsername: string };
type ReceivedGrant = Grant & { ownerId: string; ownerUsername: string };

async function fetchShares(): Promise<{ given: GivenGrant[]; received: ReceivedGrant[] } | null> {
  const response = await fetch('/api/collection-shares', {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    return null;
  }
  return response.json();
}

/**
 * Gestion des partages depuis les paramètres (Lot 7) : inviter, voir qui a accès à sa
 * collection, révoquer, et basculer vers une collection reçue.
 *
 * Charge la liste après montage plutôt que de la recevoir en props serveur : elle change
 * après chaque action (invitation générée, révocation, bascule) et ce composant est le
 * seul endroit qui en a besoin — pas la peine de faire remonter cet état à la page.
 */
export function SharingManager({ activeCollectionOwnerId }: { activeCollectionOwnerId: string }) {
  const router = useRouter();
  const [given, setGiven] = useState<GivenGrant[] | null>(null);
  const [received, setReceived] = useState<ReceivedGrant[] | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchShares().then((data) => {
      if (data) {
        setGiven(data.given);
        setReceived(data.received);
      }
    });
  }, []);

  async function refresh() {
    const data = await fetchShares();
    if (data) {
      setGiven(data.given);
      setReceived(data.received);
    }
  }

  async function generateInvite() {
    setBusy('invite');
    setError(false);
    setCopied(false);

    try {
      const response = await fetch('/api/collection-shares/invites', { method: 'POST' });
      if (!response.ok) {
        setError(true);
        return;
      }
      const data: { url: string; expiresAt: string } = await response.json();
      setInviteUrl(data.url);
      setInviteExpiresAt(data.expiresAt);
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      // Le presse-papiers peut être indisponible (contexte non sécurisé, permission
      // refusée) : le lien reste affiché et sélectionnable à la main.
    }
  }

  async function revoke(granteeId: string) {
    setBusy(granteeId);
    setError(false);

    try {
      const response = await fetch('/api/collection-shares', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ granteeId }),
      });
      if (!response.ok) {
        setError(true);
        return;
      }
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  async function switchTo(ownerId: string | null) {
    setBusy(ownerId ?? 'self');
    setError(false);

    try {
      const response = await fetch('/api/collection-shares/active', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ownerId }),
      });
      if (!response.ok) {
        setError(true);
        return;
      }
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t('sharing.invite.title')}</h2>
        <p className="text-sm text-muted">{t('sharing.invite.explanation')}</p>
        <button
          type="button"
          onClick={generateInvite}
          disabled={busy === 'invite'}
          className="self-start rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy === 'invite' ? t('sharing.invite.generating') : t('sharing.invite.generate')}
        </button>
        {inviteUrl ? (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <code className="break-all text-sm">{inviteUrl}</code>
            {inviteExpiresAt ? (
              <p className="text-xs text-muted">
                {t('sharing.invite.expiresAt', {
                  date: new Date(inviteExpiresAt).toLocaleDateString('fr-FR'),
                })}
              </p>
            ) : null}
            <button
              type="button"
              onClick={copyInvite}
              className="self-start rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {copied ? t('sharing.invite.copied') : t('sharing.invite.copy')}
            </button>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t('sharing.received.title')}</h2>
        {received === null ? null : received.length === 0 ? (
          <p className="text-sm text-muted">{t('sharing.received.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {received.map((grant) => {
              const isActive = grant.ownerId === activeCollectionOwnerId;
              return (
                <li
                  key={grant.ownerId}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                >
                  <span className="text-sm">{grant.ownerUsername}</span>
                  {isActive ? (
                    <span className="text-xs text-muted">{t('sharing.received.current')}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => switchTo(grant.ownerId)}
                      disabled={busy === grant.ownerId}
                      className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      {busy === grant.ownerId
                        ? t('sharing.received.switching')
                        : t('sharing.received.switch')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t('sharing.given.title')}</h2>
        {given === null ? null : given.length === 0 ? (
          <p className="text-sm text-muted">{t('sharing.given.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {given.map((grant) => (
              <li
                key={grant.granteeId}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <span className="text-sm">{grant.granteeUsername}</span>
                <button
                  type="button"
                  onClick={() => revoke(grant.granteeId)}
                  disabled={busy === grant.granteeId}
                  className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {busy === grant.granteeId
                    ? t('sharing.given.revoking')
                    : t('sharing.given.revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error ? (
        <p role="alert" className="text-sm text-red-500">
          {t('sharing.error')}
        </p>
      ) : null}
    </div>
  );
}
