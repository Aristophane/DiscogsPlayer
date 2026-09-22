# Dépendances — mise à jour du 22 septembre 2026

Les versions demandées sont appliquées dans `package.json` et verrouillées dans
`package-lock.json`, avec trois exceptions de compatibilité :

| Dépendance    | Version demandée | Version retenue | Motif                                                                                                                                       |
| ------------- | ---------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@types/node` | 26.6.2           | 22.20.4         | La production utilise `node:22-alpine`. Les types restent alignés sur Node 22 pour ne pas autoriser des API absentes à l'exécution.         |
| `eslint`      | 10.11.0          | 9.39.5          | `eslint-config-next` 16.3.5 dépend d'`eslint-plugin-react` 7.37.5, dont les dépendances homologues excluent ESLint 10.                      |
| `typescript`  | 7.0.2            | 5.9.3           | La chaîne `typescript-eslint` 8.x utilisée par Next exige TypeScript `>=4.8.4 <6.1.0`. Le passage à TypeScript 7 attend sa prise en charge. |

Ces contraintes ont été vérifiées dans les métadonnées du registre npm. Aucun
contournement `--force`, `--legacy-peer-deps` ou `overrides` n'est utilisé.

## Adaptations de l'outillage

- Vite 8.3.0 est déclaré explicitement : `@vitejs/plugin-react` 6.1.1 exige Vite 8,
  et Vitest 5 déclare désormais Vite comme dépendance homologue.
- jsdom 30.1.0 exige Node `^22.22.2 || ^24.15.0 || >=26.0.0`. Le champ `engines`
  et les prérequis du README reflètent cette contrainte. L'image Docker conserve
  sa branche Node 22 ; utiliser une image `node:22-alpine` à jour lors du build.
- Les couples Next / `eslint-config-next` et React / React DOM sont mis à jour
  ensemble, ainsi que les types React.
- La plage `dotenv` demandée (`^18.0.1`) résout la version corrective 18.0.2,
  publiée le 21 septembre et verrouillée dans `package-lock.json`.

## Audit npm

L'audit signale quatre alertes modérées dans la même chaîne transitive de
`drizzle-kit` : `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` →
`esbuild` 0.18.20. Cette version d'esbuild était déjà présente avant la mise à jour.
Le correctif automatique proposé rétrograderait `drizzle-kit` à 0.18.1 ; il n'est
pas appliqué. Aucune alerte élevée ou critique n'est signalée.

Références : [migration Vitest 5](https://vitest.dev/guide/migration/),
[versions prises en charge par typescript-eslint](https://typescript-eslint.io/users/dependency-versions/),
[notes de version jsdom](https://github.com/jsdom/jsdom/releases).

## Validation

Vérifié sous Node 24.20.0 et npm 11.19.0 :

- Installation npm sans conflit de dépendances homologues.
- `npm run format:check`, `npm run lint` et `npm run typecheck` réussis.
- `npm test -- --reporter=dot` : 31 fichiers, 318 tests réussis, sur la base dédiée
  `discogs_player_test` et avec les fournisseurs simulés.
- `npm run build` : build de production Next.js 16.3.5 réussi.
- Playwright 1.63.0 / Chromium : 177 parcours réussis (mobile, tablette et bureau),
  sans relance automatique, avec l'application et les tests sur la base dédiée et
  `PROVIDERS_MODE=fixtures`.

Le contrôle navigateur a aussi révélé une assertion obsolète dans
`tests/e2e/collection.spec.ts` : l'accès aux amis se fait désormais par le lien
« Amis » du header, et non par un lien sous le sélecteur de collection. Le test
vérifie ce lien actuel, en ouvrant puis refermant le menu sur petit écran.
