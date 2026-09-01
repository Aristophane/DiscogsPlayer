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

## Ordonnancement conseillé ensuite

L'ordre des lots de §24 est bon, avec deux ajustements issus de l'analyse :

- **G-17 (lecteur persistant) est traité au Lot 3**, pas au Lot 6 : le lecteur doit être
  monté dans le layout racine dès la mise en place de la navigation, sinon le Lot 6 impose
  une refonte de l'arborescence des composants.
- **G-03 (proxy d'images)** est une dépendance du Lot 3 : sans lui, la grille de pochettes
  peut ne rien afficher en production.

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
