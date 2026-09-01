# Discogs Player

Parcourez votre collection Discogs comme une pile de disques, tirez un album au hasard,
puis écoutez-le via YouTube ou un Embed Spotify.

- Spécification produit et technique : [`SPECIFICATION.md`](SPECIFICATION.md)
- Écarts identifiés et résolutions retenues : [`docs/SPEC-GAPS.md`](docs/SPEC-GAPS.md)
- Décisions techniques : [`docs/adr/`](docs/adr/)
- État d'avancement et actions humaines : [`docs/DEMARRAGE.md`](docs/DEMARRAGE.md)

## Prérequis

- **Node.js ≥ 22.13** (la chaîne ESLint refuse les versions antérieures)
- **Docker Desktop** démarré (PostgreSQL 17)
- npm 10+

## Démarrage local

```bash
cp .env.example .env.local   # puis renseigner les valeurs (voir plus bas)
docker compose up -d postgres
npm install
npm run db:migrate           # sans effet tant qu'aucune table n'existe (Lot 0)
npm run dev                  # http://localhost:3004
```

Vérification : `curl http://localhost:3004/api/health` doit répondre `200` avec l'état de
la base. Un `503 HEALTH_DATABASE_UNAVAILABLE` signifie que PostgreSQL n'est pas joignable.

Le worker se lance à part, sur la même base :

```bash
npm run worker
```

## Configuration

Toutes les variables sont décrites dans [`.env.example`](.env.example) et validées au
démarrage par Zod ([`src/lib/env.ts`](src/lib/env.ts)) : une configuration invalide fait
échouer le processus immédiatement plutôt que de dégrader silencieusement le service.

Deux valeurs sont à générer localement, jamais à partager :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # CREDENTIAL_ENCRYPTION_KEY
```

Le port **3004** n'est pas arbitraire : c'est celui déclaré comme callback OAuth auprès de
Discogs. Le changer casse l'authentification.

## Scripts

| Script                                             | Rôle                                                    |
| -------------------------------------------------- | ------------------------------------------------------- |
| `npm run dev`                                      | serveur de développement sur le port 3004               |
| `npm run build` / `start`                          | build et exécution en production                        |
| `npm run worker`                                   | worker de tâches (imports, maintenances)                |
| `npm run test` / `test:watch`                      | tests unitaires et d'intégration (Vitest)               |
| `npm run test:e2e`                                 | parcours de bout en bout (Playwright, mobile + desktop) |
| `npm run lint` / `typecheck` / `format`            | qualité de code                                         |
| `npm run db:generate` / `db:migrate` / `db:studio` | migrations Drizzle                                      |
| `npm run verify`                                   | la chaîne complète, à passer avant toute livraison      |

## Organisation du code

```
src/
  app/                 routes Next.js (App Router, composants serveur par défaut)
  modules/             domaines métier isolés (§9.3 de la spécification)
  db/                  client, schéma et migrations
  lib/                 primitives partagées, sans logique métier
  worker/              boucle de consommation des tâches
tests/
  unit/                Vitest
  e2e/                 Playwright
  fixtures/            réponses fournisseurs figées — aucun appel réseau réel en CI
```

## Développer sans clés d'API

`PROVIDERS_MODE=fixtures` remplace les adaptateurs externes par des fixtures, sans changer
la moindre branche métier (§23.3). Ce mode est interdit en production, ce que la validation
d'environnement fait respecter.
