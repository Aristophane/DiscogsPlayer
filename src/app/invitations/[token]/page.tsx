import Link from 'next/link';

import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';
import { AcceptInviteButton } from '@/modules/sharing/components/accept-invite-button';
import { previewInvite } from '@/modules/sharing/service';

/**
 * Atterrissage d'un lien d'invitation (Lot 7). Accessible sans connexion : la
 * confirmation (POST, single-use) n'a lieu qu'après authentification, sur un vrai clic —
 * jamais au simple chargement de cette page, pour qu'un aperçu de messagerie ou un robot
 * ne brûle pas le jeton avant que la personne invitée ne l'ait seulement vu (§18.5).
 */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [user, invite] = await Promise.all([getCurrentUser(), previewInvite(token)]);

  if (!invite || !invite.valid) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-start justify-center gap-4 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">{t('invitation.invalid.title')}</h1>
        <p className="text-muted">{t('invitation.invalid.explanation')}</p>
        <Link href="/" className="text-sm underline">
          {t('invitation.invalid.backHome')}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-start justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('invitation.title', { username: invite.ownerUsername })}
      </h1>
      <p className="text-muted">
        {t('invitation.explanation', { username: invite.ownerUsername })}
      </p>

      {user ? (
        <>
          <p className="text-sm text-muted">
            {t('invitation.alreadySignedInAs', { username: user.discogsUsername })}
          </p>
          <AcceptInviteButton token={token} />
        </>
      ) : (
        <a
          href={`/api/collection-shares/invites/${token}/begin`}
          className="rounded-md bg-foreground px-5 py-3 font-medium text-background"
        >
          {t('invitation.signIn')}
        </a>
      )}
    </main>
  );
}
