# ADR-0003 — Signature OAuth PLAINTEXT et sessions opaques

- Date : 2026-09-02
- Statut : accepté
- Concerne : `SPECIFICATION.md` §11, AUTH-002, AUTH-005, AUTH-006

## Contexte

Discogs impose OAuth 1.0a, qui admet deux méthodes de signature : `HMAC-SHA1` et
`PLAINTEXT`. La spécification ne tranche pas. Par ailleurs, §11 décrit la forme de la
session (jeton opaque, hash en base, expiration glissante bornée) sans fixer les durées ni
le lieu de stockage du request token secret.

## Décision

**1. Signature `PLAINTEXT` sur HTTPS.** La signature se réduit à
`consumerSecret&tokenSecret`, chaque partie percent-encodée. Le transport TLS assure déjà
la confidentialité que HMAC apporterait ; en échange, on supprime toute une classe de bugs
de normalisation (tri des paramètres, encodage de la base string, gestion du port) qui se
manifestent uniquement par un `401` opaque côté Discogs. Vérifié contre le service réel :
`oauth_callback_confirmed=true`.

**2. Request token secret en base, jamais chez le client.** Table
`discogs_request_tokens`, secret chiffré, TTL de 15 minutes, `consumed_at` posé par un
`UPDATE ... WHERE consumed_at IS NULL RETURNING`. L'usage unique est donc garanti par la
base, y compris si deux callbacks arrivent simultanément : c'est la défense contre le rejeu
et la fixation de session exigée par §11.

**3. Session opaque, double borne.** 32 octets aléatoires en base64url, SHA-256 stocké,
cookie `HttpOnly` + `SameSite=Lax` + `Secure` en production. Deux expirations :
glissante (`SESSION_IDLE_TTL_HOURS`, 30 jours) et absolue (`SESSION_ABSOLUTE_TTL_HOURS`,
90 jours) — SPEC-GAPS G-18. Un nouveau jeton est émis à chaque authentification (rotation).

`SameSite=Lax` et non `Strict` : le retour depuis `discogs.com` est une navigation
cross-site, que `Strict` bloquerait — la session serait créée puis invisible.

**4. Rôle admin depuis la configuration.** `ADMIN_DISCOGS_USER_IDS` contient des
identifiants **numériques** Discogs, validés comme tels : §5.2 interdit de déduire le rôle
du nom affiché, qui est modifiable par son titulaire.

## Conséquences

- Si Discogs venait à refuser `PLAINTEXT`, seul `plaintextSignature()` change ; le reste du
  flux est indépendant de la méthode.
- Les durées de session sont configurables et testées, pas codées en dur.
- Un request token non consommé est purgé à chaque démarrage de parcours.

## Alternatives écartées

- **HMAC-SHA1** : aucun gain de sécurité sur HTTPS, coût de débogage réel.
- **Request token secret dans un cookie signé** : expose le secret au navigateur, contraire
  à §11, et rend le rejeu détectable seulement côté client.
- **JWT de session** : impossible à révoquer avant expiration, ce qui contredit AUTH-006 et
  la suppression de compte (§19.2).
