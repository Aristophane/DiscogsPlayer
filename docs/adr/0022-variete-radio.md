# ADR-0022 — Variété de la Radio et identité du média

- Date : 2026-10-19
- Statut : accepté, corrections demandées par le porteur du produit
- Complète ADR-0006 et ADR-0007

## Problème

Le tri « correspondance en cache d'abord, hasard ensuite » ramenait chaque nouvelle
session sur un petit bassin de titres déjà écoutés. L'historique des cinq dernières
tentatives incluait les échecs. Les vidéos Discogs jamais résolues ne bénéficiaient pas
de la priorité gratuite prévue par ADR-0006. Enfin, le repli à vidéo unique réattribuait
parfois une vidéo déjà appariée à une autre piste.

## Décisions

- Calculer les correspondances locales par lots au moment du tirage, sans appel API
  ni écriture de correspondances pour les pistes non choisies. Les vidéos Discogs et
  les correspondances en cache appartiennent au même bassin gratuit.
- Utiliser exclusivement les tentatives résolues pour l'historique entre sessions.
  Éviter les 50 dernières écoutes lorsque le périmètre le permet ; ensuite préférer
  les enregistrements les moins récemment servis, avec trois écoutes d'espacement
  pour les artistes et cinq pour les albums. Ces espacements sont des préférences.
- À rang égal, tirer un artiste puis un album puis une piste : un album long ne doit
  pas avoir davantage de chances qu'un autre du même artiste.
- Parmi les titres hors historique récent, choisir d'abord ceux disponibles localement.
  Si tous les titres locaux sont récents, autoriser la découverte par recherche, dans
  la limite existante de six tentatives. Après ces échecs, revenir à une piste locale
  même récente au lieu de déclarer la Radio indisponible à tort.
- Ne pas servir deux fois la même vidéo dans une session, ni la même paire normalisée
  artiste/titre sur deux éditions. Contrôler à nouveau l'identité après une recherche.
  Sérialiser les réservations et validations d'une même session dans des transactions
  PostgreSQL courtes, sans conserver de connexion ni de verrou pendant les appels API.
- Conserver `youtube_video_id` sur la tentative résolue pour que l'historique ne dépende
  pas d'une correspondance modifiée ultérieurement. Les anciennes entrées sont remplies
  depuis leur correspondance disponible au moment de la migration.
- Ne jamais réutiliser une vidéo unique déjà appariée. Ignorer les anciens replis
  Discogs de score nul dans le cache au profit du nouvel appariement ; les réévaluer
  et les corriger à la prochaine demande de lecture, sans recherche anticipée.

## Migration et retour arrière

`0015_radio_variety.sql` ajoute une colonne nullable, sans supprimer de données. Appliquer
avec `npm run db:migrate` avant de lancer le nouveau service. Pour revenir à l'ancien
code, la colonne peut rester en place sans incidence ; sa suppression éventuelle est
`ALTER TABLE radio_session_tracks DROP COLUMN youtube_video_id` après retour du code.

## Validation

Tests unitaires de classement, espacement et appariement ; tests PostgreSQL de relances
successives, doublons audio, concurrence, correction des caches historiques et repli
après épuisement du budget de recherche. Aucun appel fournisseur réel en test.
