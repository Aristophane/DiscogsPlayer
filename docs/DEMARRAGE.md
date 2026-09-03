# Démarrage de l'implémentation

## Ce qui est déjà en place

| Élément            | Fichier                 | État                                                           |
| ------------------ | ----------------------- | -------------------------------------------------------------- |
| Dépôt Git          | `.git/`                 | initialisé, aucun commit                                       |
| Ignorés            | `.gitignore`            | prêt                                                           |
| Base locale        | `docker-compose.yml`    | PostgreSQL 17, healthcheck                                     |
| Configuration      | `.env.example`          | complété (quota en unités, User-Agent Discogs, TTL, anti-abus) |
| Instructions LLM   | `CLAUDE.md`             | prêt                                                           |
| Secrets locaux     | `.env.local`            | rempli, credentials Discogs **vérifiés** (voir ci-dessous)     |
| Analyse des écarts | `docs/SPEC-GAPS.md`     | 21 écarts + résolutions                                        |
| ADR                | `docs/adr/0001`, `0002` | journal + quota YouTube                                        |

Toolchain vérifiée sur cette machine : **Node 24.20.0 LTS, npm 11.19.0**, Docker 29.1.2,
PostgreSQL 17.11 en conteneur.

**Node est géré par nvm-windows (`nvm4w`), pas par l'installeur officiel.** `C:
vm4w
odejs`
précède `C:\Program Files
odejs` dans le PATH : installer Node depuis le site n'a donc
aucun effet visible, `node -v` continue d'afficher la version choisie par nvm. La bascule se
fait avec `nvm install 24 && nvm use 24`. À refaire après tout redémarrage où `node -v`
repasserait en 22.

## Identifiants Discogs — vérifiés le 2026-09-02

Application « Discogs Player » déclarée, clés renseignées dans `.env.local` (ignoré par Git).
Un appel réel à `POST /oauth/request_token` en signature `PLAINTEXT` a répondu
`HTTP 200` avec `oauth_callback_confirmed=true` : consumer key/secret et callback sont valides.

Deux conséquences pour l'implémentation :

- **Le port de développement est 3004**, pas 3000 — la callback enregistrée chez Discogs
  est `http://localhost:3004/api/auth/discogs/callback`. Le script `dev` doit forcer
  `next dev -p 3004`, sinon l'échange OAuth échouera.
- **`api.discogs.com` est derrière Cloudflare** et a renvoyé un `403` à `curl` là où
  `fetch` (Node) avec le même en-tête `User-Agent` passe. Toujours utiliser le client HTTP
  de l'application, avec `User-Agent` identifiant, et ne pas conclure d'un test `curl`
  qu'un identifiant est invalide.
- L'URL d'autorisation retenue est `https://www.discogs.com/oauth/authorize` (sans le
  segment `/fr`, qui n'est qu'une localisation de l'interface Discogs).

## Lot 0 — terminé le 2026-09-02

| Livrable                                   | Emplacement                                 | Vérification                        |
| ------------------------------------------ | ------------------------------------------- | ----------------------------------- |
| Next.js 16.3.4 / React 19.2.8 / Tailwind 4 | racine                                      | `npm run build` ✓                   |
| TypeScript strict durci                    | `tsconfig.json`                             | `npm run typecheck` ✓               |
| Drizzle ORM + postgres.js                  | `src/db/`, `drizzle.config.ts`              | schéma vide, migrations prêtes      |
| Validation d'environnement Zod             | `src/lib/env.ts`                            | 8 tests ✓                           |
| Logs structurés + redaction                | `src/lib/logger.ts`                         | `request_id`, `module` (§21.1)      |
| Enveloppe d'erreur §17.8                   | `src/lib/api-error.ts`                      | vérifiée via `/api/health` en panne |
| `/api/health`                              | `src/app/api/health/route.ts`               | `503` structuré base arrêtée ✓      |
| Squelette des 13 modules                   | `src/modules/*/README.md`                   | conforme §9.3                       |
| Worker (boucle, arrêt propre)              | `src/worker/main.ts`                        | `npm run worker`                    |
| Fondation i18n                             | `src/lib/i18n/`                             | 4 tests ✓, aucune chaîne en dur     |
| Lecteur persistant (G-17)                  | `src/modules/playback/components/`          | monté dans le layout racine         |
| Vitest + Playwright                        | `vitest.config.mts`, `playwright.config.ts` | 12 tests ✓                          |
| Documentation de démarrage                 | `README.md`                                 | procédure unique                    |

Chaîne complète : `npm run verify` (format, lint, typecheck, test, build).

Chemin nominal vérifié : `/api/health` répond `200` avec `database.ok = true`
(PostgreSQL 17.11 en conteneur), et le `503` structuré est confirmé base arrêtée.

**Le conteneur écoute sur le port hôte 5433, pas 5432.** Un PostgreSQL 18 est déjà installé
sur cette machine (service `postgresql-x64-18`) et occupe le 5432. Windows a laissé les deux
processus se lier au même port sans erreur, mais c'est l'instance hôte qui recevait les
connexions — l'application échouait alors sur un utilisateur `discogs` inexistant, avec un
message d'erreur en français qui a trahi l'origine. Décaler le conteneur sur 5433 évite de
toucher à l'installation existante ; `DATABASE_URL` pointe sur 5433.

## Lot 1 — identité Discogs, terminé le 2026-09-02

| Livrable                                          | Emplacement                            | Vérification                                    |
| ------------------------------------------------- | -------------------------------------- | ----------------------------------------------- |
| Schéma identité (4 tables)                        | `src/db/schema/auth.ts`                | migration `0000` appliquée                      |
| Chiffrement AES-256-GCM versionné                 | `src/modules/auth/crypto.ts`           | 9 tests, altération détectée                    |
| Client OAuth 1.0a Discogs                         | `src/modules/auth/discogs-oauth.ts`    | `302` réel vers Discogs ✓                       |
| Sessions opaques, double borne                    | `src/modules/auth/sessions.ts`         | révocation et expirations testées               |
| Service compte / rôles / jetons                   | `src/modules/auth/service.ts`          | upsert idempotent, rôle admin par configuration |
| Garde `requireUser` / `requireAdmin`              | `src/modules/auth/current-user.ts`     | `/api/me` → `401` sans session ✓                |
| Routes `start`, `callback`, `logout`, `me`        | `src/app/api/auth/`, `src/app/api/me/` | testées en HTTP                                 |
| Protection CSRF par origine                       | `src/modules/auth/cookies.ts`          | `403` sans `Origin` et sur origine étrangère ✓  |
| Écrans `/connexion`, `/parametres`, `/collection` | `src/app/`                             | rendus, aucune chaîne en dur                    |

**Critère de sortie du lot atteint** : `tests/integration/auth.test.ts` prouve que deux
comptes simulés restent isolés (sessions et jetons distincts, révocation sans effet croisé)
et qu'une session révoquée, expirée, inactive ou rattachée à un compte supprimé ne résout
plus rien. 40 tests au total, rejouables.

Décisions consignées dans ADR-0003 : signature `PLAINTEXT`, request token en base à usage
unique, session opaque à double expiration, rôle admin par configuration.

**Reste à faire par un humain** : dérouler une vraie autorisation dans le navigateur.
`/api/auth/discogs/start` a été vérifié contre le service réel (redirection `302` et secret
chiffré en base), mais le callback exige de cliquer « Autoriser » sur discogs.com. Ouvrir
<http://localhost:3004/connexion> et se connecter suffit à le valider.

## Lot 2 — import et catalogue, terminé le 2026-09-02

| Livrable                             | Emplacement                                   | Vérification                        |
| ------------------------------------ | --------------------------------------------- | ----------------------------------- |
| Schéma catalogue, collection, tâches | `src/db/schema/{catalog,collection,tasks}.ts` | migration `0001`, 12 tables         |
| File `FOR UPDATE SKIP LOCKED`        | `src/modules/sync/queue.ts`                   | 12 tests, concurrence prouvée       |
| Régulateur de débit Discogs          | `src/modules/sync/pacer.ts`                   | 5 tests + import réel sans `429`    |
| Client Discogs validé Zod            | `src/modules/sync/discogs-api.ts`             | erreurs typées, jamais de page vide |
| Algorithme d'import et reprise       | `src/modules/sync/service.ts`                 | 12 tests d'intégration              |
| Catalogue : pistes, artistes, vidéos | `src/modules/catalog/`                        | 24 tests unitaires                  |
| Worker complet                       | `src/worker/main.ts`                          | a drainé 295 tâches sans échec      |
| Routes `/api/sync-runs*`             | `src/app/api/sync-runs/`                      | testées avec session réelle         |
| Écran de progression `/import`       | `src/app/import/`                             | sondage arrêté hors import actif    |

**Critère de sortie atteint** : `tests/integration/sync.test.ts` prouve l'import paginé
avec doublons, la reprise exacte après une page en erreur (seule la page interrompue est
redemandée), et l'absence de désactivation prématurée. 100 tests au total.

### Import réel de la collection de test

351 albums, 4 pages, 3340 pistes, 355 artistes, 1409 vidéos Discogs — ces dernières
alimenteront gratuitement la résolution YouTube du Lot 6, avant tout appel d'API.

Deux enseignements que seule la vraie collection pouvait donner :

- **Sans cadence, 295 des 351 chargements de détail ont été refusés** (`429`). Le backoff
  les rattrapait, mais l'import devenait long. Le régulateur (ADR-0004) ramène ce chiffre à
  zéro : 295 tâches, une tentative chacune.
- **58 éditions (16 %) portaient `year = 0`** — la façon dont Discogs code une année
  inconnue. Stocké tel quel, cela afficherait « 0 » dans la fiche album. Corrigé dans le
  code et dans les données existantes.

Un défaut de mes propres tests a aussi été corrigé au passage : leur nettoyage supprimait
toutes les tâches `discogs.%`, y compris celles d'un import réel en cours. Le nettoyage est
désormais strictement limité aux données de test.

## Lot 3 — expérience Collection, terminé le 2026-09-02

| Livrable                              | Emplacement                                | Vérification                      |
| ------------------------------------- | ------------------------------------------ | --------------------------------- |
| Grille mobile-first, 2 à 6 colonnes   | `src/modules/collection/components/`       | captures mobile/tablette/desktop  |
| Recherche accent- et casse-insensible | `src/db/schema/catalog.ts`, `normalize.ts` | vérifiée sur la vraie collection  |
| Filtres Genre/Style avec facettes     | `collection-browser.tsx`                   | OU intra-type, ET inter-type      |
| Tri (ajout, artiste, titre, année)    | `src/modules/collection/service.ts`        | tri linguistique, pas par octets  |
| Pagination par curseur                | `src/modules/collection/cursor.ts`         | parcours complet sans doublon     |
| Proxy d'images Discogs (G-03)         | `src/app/api/images/[...path]/`            | 4 défenses testées en HTTP        |
| Fiche album                           | `src/app/sorties/[releaseId]/`             | pistes, headings, durées, formats |
| États vide/chargement/erreur/404      | `src/app/not-found.tsx`, `error.tsx`       | rendus vérifiés                   |
| Accessibilité WCAG AA                 | `src/app/globals.css`                      | axe : 0 violation sérieuse        |

**Critère de sortie atteint** : `npx playwright test` passe 18 tests sur trois tailles
d'écran (mobile 390px, tablette 820px, desktop), axe ne relève aucune violation critique ou
sérieuse, et les captures sont jointes au rapport Playwright. 136 tests unitaires et
d'intégration au total.

### Ce que les données réelles ont appris

- `æ`, `œ`, `ø`, `ß` ne sont **pas** décomposés par Unicode NFD : « agaetis » ne trouvait
  pas « Ágætis Byrjun ». Une table de correspondance explicite complète la normalisation.
- La base est en collation `en_US.utf8`, où « Ágætis » se trie **après** « Zoo ». Le tri
  porte donc sur des colonnes normalisées.
- Le texte secondaire en opacité tombait à 3,25:1 de contraste au lieu de 4,5:1 (§20.2).
- Les URL d'images Discogs contiennent des segments comme `rs:fit` : les percent-encoder
  casse la requête. Le proxy les valide sans les ré-encoder.
- Une image qui échoue **avant l'hydratation** React perd son événement `error` : le repli
  « Pochette indisponible » est aussi vérifié après hydratation.

### Deux incidents sur la base de développement

Tous deux corrigés, et à connaître car ils qualifient la discipline de test :

1. Le worker local consommait les tâches créées par les tests d'intégration.
2. Un nettoyage de test `like '9920%'` a supprimé **une édition réelle** de la collection —
   les identifiants Discogs sont des nombres à sept chiffres. La collection a été restaurée
   par une resynchronisation (351 albums).

Résolution (ADR-0005) : base `discogs_player_test` dédiée, créée automatiquement avant les
tests, et espaces de noms disjoints — préfixe `test-` ou énumération exacte, jamais un
motif qui pourrait désigner une donnée réelle.

## Décisions produit : accueil, Radio, Spotify (2026-09-02)

Discussion hors-lots sur les chemins de l'application, consignée dans ADR-0006 et
`docs/LECTURE-FOURNISSEURS.md`. Trois décisions validées :

1. **Accueil connecté à trois entrées** — Collection, Aléatoire, Radio — plutôt qu'une
   redirection directe vers la grille (amende §7.1).
2. **Le mode Radio amende RAND-006 et PLAY-007** : y entrer est une demande de lecture
   explicite, donc le lecteur démarre. Le mode Aléatoire, lui, reste silencieux — ces deux
   exigences continuent de s'appliquer telles quelles au tirage. La Radio tire d'abord
   parmi les pistes déjà résolues (1409 vidéos Discogs connues sur la collection de test),
   ce qui la rend utilisable à quota YouTube nul.
3. **Connexion Spotify à l'onboarding, sans OAuth** — un simple lien vers
   `open.spotify.com`, facultatif et rejouable. Aucun jeton reçu : l'Embed se fie à la
   session du navigateur, pas à une intégration OAuth (non-objectif §3.2 préservé).

`SPECIFICATION.md` devra être mise à jour sur RAND-006, PLAY-007, §6.1 et §7.1 ; en
attendant, ADR-0006 prévaut (hiérarchie CLAUDE.md).

## Lot 4 — Aléatoire, terminé le 2026-09-02

| Livrable                                    | Emplacement                               | Vérification                        |
| ------------------------------------------- | ----------------------------------------- | ----------------------------------- |
| Sessions et tirages                         | `src/db/schema/random.ts`                 | migration `0004`, unicité en base   |
| Service de tirage (SQL porte les garanties) | `src/modules/random/service.ts`           | 16 tests d'intégration              |
| Routes `/api/random-sessions*`              | `src/app/api/random-sessions/`            | testées avec session réelle         |
| Écran `/aleatoire`                          | `src/app/aleatoire/`, `random-drawer.tsx` | filtres, tirage, épuisement         |
| Accueil à trois entrées (ADR-0006)          | `src/app/page.tsx`                        | Radio annoncée, activée au Lot 6bis |

**Critère de sortie atteint** : `tests/integration/random.test.ts` prouve l'absence de
répétition (unicité `(session, édition)` en base, pas une vérification applicative) et
l'absence de pondération par exemplaires — vérifié à la fois de façon déterministe (un
album à 3 exemplaires ne sort qu'une fois par session) et statistiquement (sur 60 sessions,
sa fréquence en première position reste dans la fourchette attendue sans pondération).
`tests/e2e/random.spec.ts` vérifie en plus, dans un vrai navigateur, qu'**aucun `<iframe>`
n'apparaît après un tirage** — la preuve concrète de RAND-006 côté interface. 30 tests e2e
sur mobile/tablette/desktop, trois passes consécutives sans instabilité. 152 tests au total.

Les quatre garanties difficiles (RAND-001, 002, 003, 005) sont portées par le SQL — clause
`exists` plutôt que `join` pour ne pas pondérer par exemplaire, index unique
`(session_id, release_id)` pour interdire la répétition — et non par une vérification
applicative qui pourrait être contournée par un appel concurrent.

## Lot 6 (simplifié) — lecture, terminé le 2026-09-02

Lot 5 (corrections communautaires) repoussé à la demande du porteur du produit ; ce lot
livre la lecture directement, avec un modèle de résolution simplifié (ADR-0007).

| Livrable                                                                                                        | Emplacement                                          | Vérification                          |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| Schéma résolution (3 tables)                                                                                    | `src/db/schema/providers.ts`                         | migration `0005`                      |
| Appariement vidéo/piste par titre                                                                               | `src/modules/catalog/video-match.ts`                 | 11 tests, calibré sur données réelles |
| Quota YouTube en unités                                                                                         | `src/modules/providers/youtube/quota.ts`             | 5 tests, incl. bascules DST           |
| Client + service YouTube                                                                                        | `src/modules/providers/youtube/`                     | double contrôlable, aucun appel réel  |
| Service Spotify (URLs, oEmbed)                                                                                  | `src/modules/providers/spotify/service.ts`           | 8 tests                               |
| Orchestration                                                                                                   | `src/modules/resolution/service.ts`                  | 10 tests d'intégration                |
| Contexte + lecteur persistant                                                                                   | `src/modules/playback/`                              | IFrame API chargée à la demande       |
| Boutons play (album/piste)                                                                                      | `src/modules/playback/components/play-button.tsx`    | testés en e2e                         |
| En-tête de navigation                                                                                           | `src/modules/navigation/components/app-header.tsx`   | défilement mobile, pas de débordement |
| Préférence Spotify (onboarding + réglages)                                                                      | `src/modules/auth/components/spotify-preference.tsx` | facultative, rejouable                |
| Routes `/api/resolutions/*`, `/api/provider-urls/validate`, `/api/quotas/youtube`, `/api/me/spotify-preference` | `src/app/api/`                                       | testées en HTTP réel                  |

**Vérifié en conditions réelles** : résolution d'un album de la collection directement
depuis sa vidéo Discogs (`The Grip — Treble A Side`, sans aucun appel réseau), repli manuel
propre sur une édition sans vidéo (recherche YouTube échoue proprement sans clé
configurée), et lien Spotify apparaissant/disparaissant selon la préférence enregistrée.

186 tests unitaires et d'intégration, 42 tests e2e sur mobile/tablette/desktop (trois
passes consécutives sans instabilité).

### Trois défauts trouvés par les tests, pas par relecture

- **Bascule d'heure Pacifique** : la première version de `nextPacificMidnightUtc` mesurait
  le décalage horaire à l'instant présent, pas à l'instant visé — fausse dans l'heure
  suivant un changement d'heure. Corrigée par une résolution en deux passes.
- **Liste de signaux négatifs dupliquée puis divergente** : `providers/youtube/service.ts`
  avait sa propre copie de la liste de §15.2, qui a perdu « live » en la retapant. Un seul
  export partagé désormais.
- **Repli à vidéo unique trop permissif** : une vidéo « Interview Backstage » s'attribuait
  à la première piste faute de mots-clés d'exclusion adaptés. Liste étendue
  (interview, documentary, trailer, teaser…).

### Un défaut visuel, corrigé après capture

L'en-tête avec le nom de l'application et quatre liens ne tenait pas sur une ligne à
390 px et recouvrait le contenu suivant. Capture prise, défaut visible, corrigé par une
navigation qui défile horizontalement plutôt que de passer à la ligne.

## Lot 6bis — mode Radio, terminé le 2026-09-02

Suite directe du Lot 6 : une file continue de pistes plutôt qu'un tirage d'album qui
s'arrête (ADR-0006 point 2 et 3). Entrer en Radio _est_ la demande de lecture — aucun
écran intermédiaire, contrairement au mode Aléatoire.

| Livrable                                      | Emplacement                                 | Vérification                           |
| --------------------------------------------- | ------------------------------------------- | -------------------------------------- |
| Sessions et pistes de radio                   | `src/db/schema/radio.ts`                    | migration `0006`, unicité en base      |
| Service de tirage en file (repli automatique) | `src/modules/radio/service.ts`              | 10 tests d'intégration                 |
| Routes `/api/radio-sessions*`                 | `src/app/api/radio-sessions/`               | testées avec session réelle            |
| Écran `/radio`                                | `src/app/radio/`, `radio-launcher.tsx`      | filtres, lancement, épuisement         |
| Enchaînement dans le lecteur                  | `src/modules/playback/playback-context.tsx` | état `radio_ended`, tirage automatique |
| Accueil et en-tête                            | `src/app/page.tsx`, `app-header.tsx`        | lien Radio actif                       |

**Critère de sortie atteint** : le tirage suivant est réclamé atomiquement (CTE
insert-as-claim sous contrainte d'unicité `(session, piste)`), avec priorité aux pistes
déjà résolues et repli automatique sur un tirage à plusieurs tentatives
(`MAX_ATTEMPTS_PER_DRAW = 6`) avant de déclarer la session épuisée ou indisponible.
`tests/e2e/radio.spec.ts` prouve, dans un vrai navigateur, qu'entrer en Radio ouvre
directement le lecteur — sans clic supplémentaire, à la différence du mode Aléatoire.

196 tests unitaires et d'intégration, 51 tests e2e sur mobile/tablette/desktop.

### Défaut trouvé par capture d'écran, pas par relecture

Le formulaire de filtres listait toutes les valeurs de genre/style de la collection
réelle — plusieurs centaines de styles à un seul exemplaire — rendant l'écran mobile
interminable avant d'atteindre le bouton de lancement. Plafonné à 24 valeurs visibles
par facette, une valeur déjà sélectionnée restant toujours visible.

## Lot 6ter — récupération prioritaire des pistes, terminé le 2026-09-03

En production, l'import d'une collection réelle ramène les albums immédiatement mais
leurs pistes seulement au rythme du quota Discogs (~1,1 s/appel) — plusieurs minutes
pour une grosse collection. Signalé par l'utilisateur : cliquer play sur un album pas
encore détaillé échouait silencieusement (retour à `idle`, aucun message), et la fiche
album affichait un texte statique sans qu'aucune action ne fasse avancer les choses.

| Livrable                                        | Emplacement                                                          | Vérification                    |
| ----------------------------------------------- | -------------------------------------------------------------------- | ------------------------------- |
| Priorité de file (`tasks.priority`)             | `src/db/schema/tasks.ts`                                             | migration `0007`                |
| `enqueue()` fusionne au lieu de dupliquer       | `src/modules/sync/queue.ts`                                          | 6 tests d'intégration           |
| Récupération prioritaire déclenchée par un clic | `src/modules/sync/service.ts` (`requestPriorityReleaseFetch`)        | 2 tests d'intégration           |
| Route de résolution album (`status: 'pending'`) | `src/app/api/resolutions/album/route.ts`                             | testée en e2e                   |
| Sondage côté client + relance de lecture        | `src/modules/playback/playback-context.tsx`, `tracklist-pending.tsx` | e2e (spinner, priorité en base) |
| Sonde de disponibilité                          | `src/app/api/releases/[discogsReleaseId]/status/`                    | GET qualifié par utilisateur    |
| Animation de chargement (disque qui tourne)     | `src/lib/ui/vinyl-spinner.tsx`                                       | fiche album, lecteur, pochettes |

**Critère de sortie atteint** : `enqueue()` fait remonter la priorité d'une tâche déjà
programmée par l'import en arrière-plan sans jamais la redescendre (`greatest` en SQL,
sur l'index unique partiel de déduplication) — vérifié par insertion concurrente en
base, pas seulement en lisant le code. `claim()` sert désormais la priorité la plus
haute avant l'ancienneté. Visiter une fiche album ou cliquer play sur une édition pas
encore détaillée déclenche cette récupération prioritaire et affiche une attente
active (animation + message), jamais un échec silencieux ni un texte figé — prouvé en
e2e par une lecture directe de la table `tasks` après clic, pas seulement par ce que
l'écran affiche.

201 tests unitaires et d'intégration, 54 tests e2e sur mobile/tablette/desktop.

### Un changement de comportement délibéré, pas une régression

`enqueue()` ne renvoyait auparavant `null` que pour signaler une tâche déjà vivante —
comportement remplacé par une fusion (même ligne mise à jour, priorité et `run_after`
réconciliés) : nécessaire pour qu'un clic utilisateur puisse faire remonter une tâche
que l'import avait déjà programmée à priorité normale. `tests/integration/queue.test.ts`
a été réécrit en conséquence, pas seulement complété.

## Lecteur réductible et suppression du collage manuel, 2026-09-03

Deux demandes du porteur du produit, indépendantes l'une de l'autre.

**Lecteur réductible.** La vidéo YouTube pouvait recouvrir une bonne partie de l'écran en
parcourant la collection en même temps qu'une lecture. Un bouton ▾/▴ dans la barre du
lecteur replie désormais tout ce qui est en dessous de la ligne titre/artiste (vidéo,
Spotify, messages d'état) par une transition CSS (`grid-template-rows`), jamais en
retirant le conteneur YouTube du DOM ni par `display: none` — les deux coupent la lecture
dans la plupart des navigateurs, alors que le repli visuel seul la laisse continuer. Une
nouvelle lecture s'ouvre toujours dépliée ; un repli choisi par l'utilisateur reste replié
le temps d'une même écoute (`src/modules/playback/components/player-bar.tsx`).

**Repli manuel « coller un lien » retiré.** SPECIFICATION.md §13.1/§14.2 prévoyait un
champ pour coller une URL YouTube/Spotify quand la résolution automatique échoue —
jugé sans utilité réelle par le porteur du produit, retiré à sa demande explicite. Les
liens de recherche (« Rechercher sur YouTube »/« Rechercher sur Spotify ») restent le
seul repli manuel. Supprimés : `pasteUrl` (`playback-context.tsx`),
`POST /api/provider-urls/validate` (route entière), le formulaire correspondant et ses
clés i18n. Conservés à dessein : `canonicalizeSpotifyUrl`/`validateViaOEmbed`
(`providers/spotify/service.ts`) et `youtubeIdFromUrl` (`catalog/normalize.ts`) — des
utilitaires génériques d'analyse d'URL, utilisés ailleurs (résolution, Lot 5 futur), pas
spécifiques à ce formulaire. Décision consignée dans ADR-0007 (addendum), qui amende
explicitement SPECIFICATION.md §13.1/§14.2/§17.5.

Aucun test dédié n'existait pour cette route ou pour `pasteUrl` : rien à réécrire de ce
côté. `npm run verify` complet repassé après coup.

## Radio non répétitive, bouton suivant, vidéo rognée, 2026-09-03

Trois demandes du porteur du produit sur la même session de travail.

**Radio non répétitive au redémarrage.** Relancer la radio rouvrait quasi
systématiquement sur le même titre : le tri de `claimNextCandidate`
(`(exists track_resolutions) desc, random()`) place les pistes déjà résolues devant —
souvent une seule au début, donc un groupe de taille 1 sur lequel `random()` n'a aucun
effet. `recentlyPlayedTrackIds` (nouveau, `src/modules/radio/service.ts`) écarte désormais les dernières pistes jouées par
l'utilisateur, toutes sessions confondues, sauf si ça ne laisse plus rien d'éligible
(repli automatique, « dans la mesure du possible » — jamais d'épuisement à tort sur un
périmètre filtré restreint). Deux tests d'intégration : l'un prouve la non-répétition
sur un périmètre large, l'autre le repli quand une seule piste existe.

**Bouton « piste suivante ».** `advanceQueue` (`playback-context.tsx`), jusqu'ici
déclenché seulement par la fin automatique d'une vidéo YouTube, accepte maintenant
aussi les états `playing_spotify` et `unresolved` en point de départ — un Spotify
Embed n'a pas d'événement de fin exploitable, un repli manuel encore moins, mais
l'utilisateur doit pouvoir passer outre dans les deux cas. Exposé via `skip()`, un
bouton ⏭ dans la barre du lecteur, visible dans ces trois états. Fonctionne à la fois
pour un album (piste suivante) et pour la Radio (nouveau tirage), `advanceQueue`
distinguant déjà les deux via `activeRadioSessionRef`.

**Vidéo rognée en mode déplié.** `new YT.Player(...)` crée l'iframe avec ses
dimensions par défaut (640×360, en dur, hors du contrôle de Tailwind puisque React ne
la rend jamais) : elle débordait de son cadre 16:9 au lieu de s'y adapter — vérifié en
inspectant les rectangles réels (iframe 640×360 dans un conteneur mesuré à 358×216).
Corrigé par une règle CSS ciblée (`.youtube-player-container`, `globals.css`) :
`position: absolute; inset: 0; width/height: 100%` sur l'iframe, la seule façon de la
contraindre puisqu'on ne peut pas lui poser de classe par JSX. Vérifié en e2e par
comparaison directe des rectangles réels de l'iframe et de son conteneur (tolérance
1 px), pas seulement par capture d'écran.

203 tests unitaires et d'intégration, 66 tests e2e (mobile/tablette/desktop).

## Ordonnancement conseillé ensuite

L'ordre des lots de §24 est bon, avec deux ajustements issus de l'analyse :

- ~~**G-17 (lecteur persistant) est traité au Lot 3**~~ — **fait dès le Lot 0** : le
  lecteur est monté dans le layout racine.
- ~~**G-03 (proxy d'images)** est une dépendance du Lot 3~~ — **fait au Lot 3**.

Les lots 1, 2, 3, 4 sont réalisables sans aucune clé réelle grâce à `PROVIDERS_MODE=fixtures`.
Les clés Discogs ne deviennent nécessaires que pour valider le Lot 1 contre le vrai service ;
la clé YouTube seulement au Lot 6.

## Actions humaines par lot

| Lot | Action humaine requise                                                               | Quand               |
| --- | ------------------------------------------------------------------------------------ | ------------------- |
| 0   | aucune                                                                               | —                   |
| 1   | ~~application Discogs déclarée (consumer key/secret, callback)~~                     | **fait, vérifié**   |
| 1   | liste `ADMIN_DISCOGS_USER_IDS`                                                       | avant Lot 5         |
| 2   | compte Discogs de test avec une collection réelle (doublons, éditions sans pochette) | utile               |
| 5   | trancher G-13 : définition d'un confirmateur « indépendant »                         | bloquant            |
| 6   | projet Google Cloud + clé YouTube Data API v3                                        | bloquant            |
| 6   | valider ADR-0002 et faire corriger §13.3 du document                                 | bloquant            |
| 8   | politique de confidentialité, CGU, adresse de support                                | avant mise en ligne |
| 8   | hébergeur, domaine, politique de sauvegarde (§26)                                    | avant mise en ligne |
