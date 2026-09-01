# Discogs Player — instructions de dépôt

## Sources de vérité

1. `SPECIFICATION.md` — source de vérité produit et technique (termes normatifs §1).
2. `docs/SPEC-GAPS.md` — écarts identifiés et résolutions par défaut. **À lire avant tout
   lot** : il corrige plusieurs points de la spécification (notamment le modèle de quota
   YouTube, G-01).
3. `docs/adr/` — journal des décisions. Toute décision technique structurante y ajoute une
   entrée numérotée.

En cas de conflit : ADR > SPEC-GAPS > SPECIFICATION.md (une entrée plus récente explicite
l'emporte, mais ne doit jamais changer une décision **produit** sans validation humaine).

## Règles de travail (dérivées de §24)

- Un lot à la fois. Ne jamais démarrer le lot N+1 avant que le critère « Terminé quand »
  du lot N soit vérifié par des tests exécutés.
- Inspecter l'existant avant de modifier ; proposer un plan court et la liste des fichiers.
- Migrations additives et réversibles, une par lot minimum, jamais de modification
  destructive d'une migration déjà appliquée.
- Tests écrits avec la logique, pas après.
- **Aucun appel à une API réelle en CI ni dans les tests** : `PROVIDERS_MODE=fixtures`.
- Avant de livrer : `format`, `lint`, `typecheck`, `test`, `build`.
- Ne jamais inventer une API de bibliothèque : lire la version installée dans
  `node_modules` ou la documentation de la version verrouillée.
- Ne jamais déclarer terminé ce qui n'a pas été exécuté et vérifié.

## Conventions

- TypeScript strict, aucun `any` implicite, aucun `@ts-ignore` sans justification en ligne.
- Frontières externes (HTTP entrant, réponses fournisseurs, env, JSONB) : validation Zod
  systématique. Un type non validé venant de l'extérieur est un bug.
- Composants serveur par défaut ; `"use client"` uniquement quand l'interactivité l'exige.
- Un module (`src/modules/*`) n'accède pas aux tables d'un autre module : il passe par son
  service. Les requêtes SQL d'un module vivent dans ce module.
- Toute requête portant sur des données utilisateur filtre par `user_id` issu **de la
  session serveur**, jamais d'un paramètre client (§18.5).
- Aucune chaîne d'interface en dur : catalogue i18n dès le premier écran (G-12).
- Erreurs API au format §17.8, avec `requestId`.
- Secrets : jamais de préfixe `NEXT_PUBLIC_`, jamais dans un log, une URL ou une trace.

## Commandes

```bash
docker compose up -d postgres   # base locale
npm run dev                     # application web
npm run worker                  # worker de tâches
npm run lint && npm run typecheck && npm run test && npm run build
```

(Les scripts sont créés au Lot 0 ; cette section est mise à jour en même temps.)

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
