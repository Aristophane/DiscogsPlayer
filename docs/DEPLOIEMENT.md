# Déploiement — VPS Docker Compose (Coolify)

Ce document couvre ce qui est **technique** : construire l'image, la déployer via
Coolify, configurer les variables d'environnement. Les décisions **produit/humaines**
listées en SPECIFICATION.md §26 (hébergeur exact, nom de domaine, politique de
confidentialité et CGU, adresse de support, politique de sauvegarde, décision de
lancement bêta) ne sont pas tranchées ici — ce guide suppose qu'elles le sont déjà pour
les points strictement nécessaires à la mise en ligne (un domaine, un VPS).

Rien dans ce commit ne modifie l'environnement de développement local : `docker-compose.yml`
(Postgres seul, pour `npm run dev`) est inchangé. `docker-compose.prod.yml` est un fichier
séparé, utilisé uniquement par Coolify.

## Vue d'ensemble

```
Dockerfile               image unique (migration, app web, worker — commande différente par service)
docker-compose.prod.yml  4 services : migrate, app, worker, postgres
.env.example              modèle des variables (déjà existant, sert au local ET à la prod)
```

Une seule image sert les deux processus (§9.4 : « même code et même base que
l'application Web, processus distinct »). Pas de sortie `standalone` de Next : le worker
exécute du TypeScript via `tsx`, il lui faut `node_modules` complet de toute façon —
optimiser l'image web seule n'aurait réduit ni la complexité ni la taille de l'image
worker, pour un gain marginal sur un VPS mono-instance.

## 1. Prérequis côté VPS

- Un VPS avec [Coolify](https://coolify.io) installé (Coolify gère lui-même Traefik,
  les certificats Let's Encrypt et le réseau Docker — rien à configurer manuellement de
  ce côté).
- Un nom de domaine (ou sous-domaine) pointé vers l'IP du VPS.
- Le dépôt Git accessible à Coolify (connexion GitHub/GitLab ou dépôt public).

## 2. Créer la ressource dans Coolify

1. Nouvelle ressource → **Docker Compose**.
2. Pointer sur ce dépôt, fichier `docker-compose.prod.yml`.
3. Dans l'onglet **Domains** de la ressource, assigner le domaine au service `app`
   (celui qui expose le port 3004) — Coolify attache alors son proxy Traefik géré
   automatiquement (domaine + TLS). Ne rien ajouter à la main dans le compose pour ça.
4. Renseigner les variables d'environnement (§3 ci-dessous) dans l'onglet **Environment
   Variables** de la ressource — Coolify les injecte dans les services via le `.env` que
   `docker-compose.prod.yml` référence.

## 3. Variables d'environnement

Base : [`.env.example`](../.env.example) — chaque variable y est commentée et validée au
démarrage par Zod (`src/lib/env.ts`). Ce qui change entre local et production :

| Variable                                      | Local (`.env.local`)                                       | Production                                                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                    | `development`                                              | `production`                                                                                                                  |
| `PROVIDERS_MODE`                              | `live` ou `fixtures`                                       | **doit être `live`** — `fixtures` est refusé au démarrage en production (AUTH-003, env.ts)                                    |
| `DISCOGS_PERSONAL_TOKEN`                      | facultatif                                                 | **doit être vide** — refusé au démarrage sinon (AUTH-003)                                                                     |
| `APP_BASE_URL`                                | `http://localhost:3004`                                    | `https://votre-domaine`                                                                                                       |
| `DISCOGS_CALLBACK_URL`                        | `http://localhost:3004/api/auth/discogs/callback`          | `https://votre-domaine/api/auth/discogs/callback` — **doit être déclarée à l'identique côté application Discogs développeur** |
| `DATABASE_URL`                                | `postgres://discogs:discogs@localhost:5433/discogs_player` | `postgres://discogs:<POSTGRES_PASSWORD>@postgres:5432/discogs_player` — voir piège ci-dessous                                 |
| `SESSION_SECRET`, `CREDENTIAL_ENCRYPTION_KEY` | générées une fois, dans `.env.local` (non commité)         | générées une fois pour la prod, **différentes** de celles du local, saisies dans Coolify uniquement                           |

Génération des deux secrets (même commande que le développement, README.md) :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # CREDENTIAL_ENCRYPTION_KEY
```

**Piège `DATABASE_URL`** : `docker-compose.prod.yml` charge les variables depuis `.env`
via `env_file`, qui prend les valeurs **littéralement** — Docker Compose n'interpole pas
`${POSTGRES_PASSWORD}` à l'intérieur d'un fichier chargé par `env_file` (seulement dans
le YAML du compose lui-même). Il faut donc écrire le mot de passe deux fois dans les
variables Coolify : une fois dans `POSTGRES_PASSWORD`, une fois recopié en clair dans
`DATABASE_URL`. L'hôte est `postgres` (nom du service Compose), pas `localhost`.

`YOUTUBE_API_KEY` devient obligatoire en pratique dès que `PROVIDERS_MODE=live` (sinon
toute résolution qui ne passe pas par une vidéo Discogs déjà connue échoue proprement,
sans casser l'app — mais sans lecture non plus).

## 4. Migrations

Un service dédié, `migrate`, applique les migrations en attente (`npm run db:migrate`,
Drizzle) puis se termine — ce n'est pas un serveur. `app` et `worker` attendent sa
réussite (`condition: service_completed_successfully`) avant de démarrer.

Ce détail vient d'un vrai défaut trouvé en vérification locale : `postgres` répond
« en bonne santé » bien avant que la migration ne soit terminée. Sans cette dépendance
explicite, `worker` interrogeait une table pas encore créée dès son premier cycle
(`relation "tasks" does not exist`), quelques centaines de millisecondes après le
démarrage. Rejouable sans risque à chaque déploiement — seules les migrations non
encore appliquées sont jouées, jamais de ré-application ni de modification destructive
(discipline CLAUDE.md).

## 4 bis. Le piège `NODE_ENV` au build (déjà corrigé, à ne pas réintroduire)

Coolify injecte **toutes** les variables d'environnement comme `--build-arg`, y compris
`NODE_ENV=production`. Or npm, voyant `NODE_ENV=production`, **omet les
devDependencies** : le premier déploiement a échoué sur
`Cannot find module '@tailwindcss/postcss'`, après n'avoir installé que 61 paquets au
lieu de 531.

Le `Dockerfile` force donc `npm ci --include=dev`. Ce projet a besoin des
devDependencies deux fois :

- **pour construire** — Tailwind et TypeScript ;
- **à l'exécution** — `tsx` fait tourner le worker, `drizzle-kit` applique les migrations.

Ne pas remplacer par `npm ci --omit=dev` en croyant alléger l'image : le worker et les
migrations cesseraient de démarrer. L'alternative côté Coolify (décocher « Available at
Buildtime » pour `NODE_ENV`) fonctionne aussi, mais dépend d'une case à cocher dans une
interface — le drapeau dans le `Dockerfile` rend le build correct quelle que soit la
plateforme.

## 4 ter. Comment les variables atteignent réellement les conteneurs

Les valeurs sont saisies dans l'interface de Coolify. Coolify les transmet à Docker
Compose, qui s'en sert pour **interpoler** le YAML (`${POSTGRES_PASSWORD}`). Mais
interpoler ne peuple pas l'environnement des conteneurs — ce sont deux mécanismes
distincts. Il faut le demander explicitement, service par service.

Deux formes ont été écartées, chacune pour une raison mesurée :

**`env_file: - .env`** — écarté. `.env` est ignoré par Git : il est absent du dépôt
cloné au moment où Coolify analyse le compose, et un `env_file` manquant est une
**erreur** de `docker compose config`, pas un avertissement :

```console
$ docker compose -f docker-compose.prod.yml config --quiet ; echo $?
env file /chemin/.env not found
1
```

Coolify échouait alors sur « Failed to read Git source. Please verify repository access »
— libellé trompeur, la trace réelle pointant `Application->loadComposeFile()`. Et de
façon intermittente, Coolify gardant parfois le compose analysé en cache.

**`environment: { VAR: ${VAR} }`** — écarté aussi. Une variable non définie serait
injectée comme **chaîne vide**, alors qu'un défaut Zod (`src/lib/env.ts`) ne s'applique
qu'à `undefined`. `YOUTUBE_DAILY_QUOTA_UNITS` par exemple partirait en `z.coerce.number()`
sur `""`, donc `0`, qui échoue `.positive()` — l'application refuserait de démarrer.

**Forme retenue** : la liste de noms sans valeur, partagée par ancre YAML entre `app` et
`worker`.

```yaml
x-app-environment: &app-environment
  - APP_BASE_URL
  - DATABASE_URL
  # ...
```

Docker Compose transmet alors la variable si elle est définie et l'omet **totalement**
sinon — vérifié en exécutant un conteneur, une variable non définie y est absente et non
vide. Les défauts Zod s'appliquent donc normalement.

Conséquence à retenir : **cette liste est le contrat**. Une variable présente dans
`.env.example` mais absente du compose ne peut pas être configurée en production, quoi
qu'on saisisse dans l'interface de Coolify. La tenir à jour avec `src/lib/env.ts`.

Le service `migrate` ne reçoit que `DATABASE_URL` : `drizzle-kit migrate` ne lit rien
d'autre.

## 4 quater. « Failed to read Git source » — un piège côté serveur, pas côté dépôt

Symptôme : Coolify échoue sur **« Failed to read Git source. Please verify repository
access and try again. »** alors que, dans le log lui-même, `git ls-remote` puis
`git clone` réussissent quelques lignes plus haut. Le dépôt est public et accessible.

Le message ne vient pas de la lecture du compose : `loadComposeFile()` commence par
appeler `getGitRemoteStatus()`, qui lance son propre `git ls-remote` **sur l'hôte, en
root** (`exec_in_docker: false`) — et non dans le conteneur d'aide dont on voit le
succès dans le log. C'est ce contrôle-là qui échoue.

Cause : sur cet hôte (Ubuntu, git 2.43), le protocole git v2 en **HTTP/2** obtient un
`401` de GitHub sur la seconde requête, alors que la première passe :

| Requête                 | Protocole | Réponse                                        |
| ----------------------- | --------- | ---------------------------------------------- |
| `GET /info/refs`        | HTTP/2    | 200                                            |
| `POST /git-upload-pack` | HTTP/2    | 401 + `www-authenticate: Basic realm="GitHub"` |

Git en conclut qu'il lui faut des identifiants, demande un `Username`, n'a pas de
terminal, et échoue — sur un dépôt pourtant public.

Correctif, à appliquer **sur le serveur**, pas dans ce dépôt :

```bash
sudo -i git config --global http.version HTTP/1.1
sudo -i git ls-remote <url du dépôt> refs/heads/master   # doit afficher la SHA
```

`sudo -i` est nécessaire : sans lui, `--global` écrit dans le `.gitconfig` de
l'utilisateur courant, que Coolify (qui opère en root) ne lit pas.

À noter : Coolify force déjà `-c http.version=HTTP/1.1` sur son `git clone`, mais pas
sur le `ls-remote` de ce contrôle préalable. D'où un clone qui réussit et un contrôle
qui échoue dans le même déploiement — l'incohérence qui rend le diagnostic si
déroutant.

## 5. Vérification après déploiement

```bash
curl https://votre-domaine/api/health
```

Doit répondre `200` avec `"status":"ok"` et le compte de migrations appliquées. Un `503`
signifie que Postgres n'est pas joignable depuis le conteneur `app` (vérifier
`DATABASE_URL` et que le service `postgres` est bien `healthy` dans Coolify).

## 6. Ce qui reste une décision humaine (§26), pas traitée ici

- **Sauvegarde** : aucune automatisée n'est en place. `docker-compose.prod.yml` isole
  les données Postgres dans un volume nommé (`pgdata`) — un `pg_dump` régulier
  (cron sur le VPS, ou fonctionnalité de sauvegarde de Coolify si activée) reste à
  planifier avant tout lancement au-delà d'un usage personnel.
- **Politique de confidentialité, CGU, adresse de support** : non rédigées.
- **Décision de lancement bêta et nombre maximal d'utilisateurs** : non tranchée —
  aucune limite d'inscription n'existe dans le code à ce jour.
- **Clé YouTube et quota associé** (`YOUTUBE_DAILY_QUOTA_UNITS`) : à dimensionner selon
  le nombre d'utilisateurs attendu, cf. ADR-0002.
