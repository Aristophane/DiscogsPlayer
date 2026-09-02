# syntax=docker/dockerfile:1
#
# Image de production — application web (Next.js) et worker de tâches (SPECIFICATION.md
# §9.4) partagent la même image ; seule la commande de démarrage diffère (voir
# docker-compose.prod.yml). Pas de sortie `standalone` : le worker exécute du TypeScript
# directement via tsx (comme en local, `npm run worker`) et a donc besoin de node_modules
# complet, ce qui rend l'optimisation `standalone` de Next inutile ici (elle ne réduirait
# que l'image web, pas l'image worker, pour un déploiement mono-VPS où la taille importe
# peu). Voir docs/DEPLOIEMENT.md.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `--include=dev` n'est pas décoratif : la plateforme de déploiement (Coolify) injecte
# `NODE_ENV=production` comme build-arg, ce qui pousse npm à omettre les devDependencies
# — le build échouait alors sur `Cannot find module '@tailwindcss/postcss'` après n'avoir
# installé que 61 paquets. Le drapeau force l'installation complète quel que soit
# `NODE_ENV`, ce dont ce projet a besoin deux fois : pour construire (Tailwind,
# TypeScript) et pour l'exécution même (tsx pour le worker, drizzle-kit pour les
# migrations). Ne pas le retirer en croyant alléger l'image.
RUN npm ci --include=dev

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_TELEMETRY_DISABLED : build reproductible, aucun appel réseau superflu.
ENV NEXT_TELEMETRY_DISABLED=1
# `next build` importe chaque route pour collecter ses métadonnées (page data collection),
# ce qui exécute `getEnv()` (src/lib/env.ts) même au moment du build — avant que Coolify
# n'injecte les vraies variables au démarrage du conteneur. Valeurs factices, syntaxiquement
# valides, jamais utilisées à l'exécution : elles ne servent qu'à satisfaire la validation
# Zod pendant cette étape, aucune connexion réseau ou base n'a lieu ici.
ENV APP_BASE_URL=http://build-time.invalid \
    DATABASE_URL=postgres://build:build@build-time.invalid:5432/build \
    SESSION_SECRET=0000000000000000000000000000000000000000000 \
    CREDENTIAL_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    DISCOGS_CONSUMER_KEY=build-time-placeholder \
    DISCOGS_CONSUMER_SECRET=build-time-placeholder \
    DISCOGS_CALLBACK_URL=http://build-time.invalid/api/auth/discogs/callback \
    DISCOGS_USER_AGENT=DiscogsPlayer/build \
    PROVIDERS_MODE=live
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S app && adduser -S app -G app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src

USER app
EXPOSE 3004

# Pas de CMD par défaut : docker-compose.prod.yml fixe la commande par service
# (`npm run db:migrate` pour la migration, `npm run start` pour l'application,
# `npm run worker:prod` pour le worker).
