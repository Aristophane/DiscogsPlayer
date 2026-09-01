# Écarts, contradictions et zones grises de SPECIFICATION.md v1.0

Statut : analyse du 2 septembre 2026, avant Lot 0.
Chaque entrée propose une résolution par défaut applicable immédiatement (principe §1 :
« l'option la plus simple, réversible et testable »). Les entrées **[HUMAIN]** exigent
une décision du porteur du produit avant le lot concerné.

---

## A. Erreurs factuelles à corriger dans le document

### G-01 — Modèle de quota YouTube faux (§13.3) — bloquant Lot 6

Le document décrit « 100 appels `search.list` par jour » **et** « un compartiment séparé
de 10 000 unités par jour ». Il n'existe qu'**un seul** compartiment quotidien
(10 000 unités par projet par défaut) ; `search.list` coûte 100 unités et `videos.list`
1 unité. Les « 100 recherches/jour » ne sont donc pas une limite séparée mais la
conséquence de 10 000 / 100 — et **chaque validation `videos.list` consomme le même
compartiment**.

_Résolution retenue_ : modéliser le quota **en unités**, pas en appels.
`provider_quota_windows.operation = 'youtube.units'` avec un coût par opération
(`YOUTUBE_SEARCH_UNIT_COST`, `YOUTUBE_VIDEOS_UNIT_COST`) et une réserve
(`YOUTUBE_SEARCH_RESERVE_UNITS`) qui interdit aux recherches d'assécher les validations.
L'UI dérive « recherches restantes estimées » = (unités restantes − réserve) / coût.
→ §13.3 du document doit être réécrit ; ADR-0002.

### G-02 — Rétention YouTube non chiffrée (§13.7)

Les Developer Policies YouTube imposent de rafraîchir ou supprimer les données d'API
stockées **au moins tous les 30 jours**. Le document dit seulement « cache avec date
d'expiration ».
_Résolution_ : `provider_entities.metadata_expires_at <= metadata_fetched_at + 30 j`
(`PROVIDER_METADATA_MAX_AGE_DAYS`), tâche de purge périodique, test unitaire sur
l'invariant. Les champs _fonctionnels_ (`external_id`, `canonical_url`, la relation
corrigée) sont conservés — ils ne sont pas des métadonnées de catalogue.

### G-03 — Images Discogs non traitées (§7.3) — bloquant Lot 3

La grille repose sur `primary_image_url`, mais les images Discogs (`i.discogs.com`)
sont servies avec des restrictions de hotlinking et l'API exige un `User-Agent` propre.
Aucune stratégie image n'est spécifiée (proxy ? cache ? `next/image` remotePatterns ?).
_Résolution par défaut_ : route serveur `/api/images/[...]` en proxy strict
(allowlist d'origines Discogs, timeout, taille max, cache HTTP immuable), consommée par
`next/image` via un loader custom. Décision réversible ; à réévaluer selon le coût.

### G-04 — `DISCOGS_USER_AGENT` absent des variables d'environnement (§23.2)

L'API Discogs renvoie 403 sans User-Agent identifiant. Ajouté au `.env.example`.

### G-05 — `SESSION_SECRET` incohérent (§11 vs §23.2)

Les sessions sont des jetons opaques **hachés** en base : aucun secret n'est nécessaire.
_Résolution_ : `SESSION_SECRET` est conservé mais requalifié — il ne signe que l'état
OAuth court terme (protection contre la fixation de session, §11).

---

## B. Contradictions internes

### G-06 — `mapping_proposals` sans version d'algorithme (§10.4 vs §15)

§15 exige « la proposition conserve la version de l'algorithme utilisée », absente du schéma.
_Résolution_ : ajouter `scoring_algorithm_version` (texte) et `scoring_reasons` (JSONB),
ce dernier alimentant le champ `reasons[]` de la réponse API §17.5 — également non stocké.

### G-07 — `user_mapping_preferences` sans clé (§10.4 vs §17.6)

La table n'a pas d'`id` alors que `DELETE /api/user-mapping-preferences/{id}` l'exige.
_Résolution_ : `id` UUID + unique `(user_id, provider, scope_type, release_id, track_id)`
avec `NULLS NOT DISTINCT` (PostgreSQL 15+), car `track_id` est nullable et `NULL` ne
déduplique pas par défaut.

### G-08 — Clés manquantes sur trois tables (§10)

- `provider_quota_windows` : aucune PK → unique `(provider, operation, window_start)`.
- `playback_events.idempotency_key` « unique par utilisateur » → unique `(user_id, idempotency_key)`.
- `random_sessions` : rien n'empêche deux sessions actives alors que RAND-003 suppose une
  session courante → index partiel unique sur `(user_id) WHERE completed_at IS NULL`.

### G-09 — Contrainte `discogs_tracks` trop large (§10.2)

`(release_id, discogs_position, ordinal)` : `discogs_position` est vide pour les headings
et index tracks ; `ordinal` suffit et est le seul ordre fiable.
_Résolution_ : unique `(release_id, ordinal)`, `discogs_position` reste un simple attribut.

### G-10 — Suppression de compte vs `users.deleted_at` (§10.1 vs §19.2)

Le schéma prévoit un soft delete, §19.2 impose la suppression effective des données privées.
_Résolution_ : `deleted_at` marque le compte comme purgé (tombstone conservé pour
l'intégrité des clés étrangères d'audit) ; credentials, sessions, événements, favoris,
préférences et instances de collection sont **supprimés physiquement**. À écrire noir sur
blanc dans la politique de confidentialité.

### G-11 — Restauration exigée au Lot 8 mais reportée en §26

Le critère « la procédure de restauration passe » dépend d'une décision d'exploitation
non prise. _Résolution_ : le Lot 8 valide une procédure **locale** documentée
(`pg_dump`/`pg_restore` + rejeu des migrations) ; la politique de sauvegarde hébergée
reste une décision humaine.

### G-12 — Routes en français vs architecture i18n (§7.1, §29)

Les URLs sont francisées alors que l'i18n est une décision validée ; migrer les routes
plus tard casserait les liens.
_Résolution_ : conserver les chemins français en v0 **sans** segment de locale, extraire
100 % des chaînes dans des catalogues dès le Lot 3 (aucune chaîne UI en dur), et traiter
le routage multilingue comme une décision v1 documentée.

---

## C. Sous-spécifications bloquant du code

### G-13 — « Confirmation indépendante » non définie (MAP-003, §16.3) — [HUMAIN], Lot 5

Une seule confirmation promeut une correspondance au rang de vérité globale. Rien ne
définit l'« indépendance » : deux comptes Discogs créés le même jour suffiraient.
_Défaut proposé, entièrement configurable_ : le confirmateur doit être ≠ soumissionnaire,
avoir un compte de plus de 7 jours, **posséder l'édition concernée dans sa collection**,
et être `contribution_status = 'active'`. Seuil de promotion = confirmations − rejets ≥ 1.
Paramètres en configuration versionnée, pas en dur.

### G-14 — Règle de conflit incomplète (§16.2)

« l'ancienne devient `superseded` ou reste candidate selon la règle de score » — la règle
n'existe pas. _Résolution_ : une seule proposition `preferred` par (portée, fournisseur),
garantie par index partiel unique ; l'ancienne passe `superseded` systématiquement ;
l'admin peut la restaurer (MAP-005). Départage entre deux candidates au même seuil :
confirmations nettes, puis `confidence_score`, puis `created_at`.

### G-15 — Pagination et tri non spécifiés (§17.3)

`cursor=` et `sort=` sans format ni valeurs. _Résolution_ : curseur opaque base64
`{sortKey, id}`, tri parmi `date_added_desc` (défaut), `artist_asc`, `title_asc`,
`year_desc` ; enveloppe `{ items, nextCursor }` commune à toutes les listes.

### G-16 — Réservation de quota sans libération (§10.6)

« Mise à jour atomique obligatoire avant tout appel » : rien ne décrit l'appel qui échoue
avant consommation réelle. _Résolution_ : réserver avant l'appel ; ne jamais rembourser
sur 4xx/5xx applicatif (Google a compté) ; rembourser uniquement sur échec réseau avant
émission ; l'erreur `quotaExceeded` force `exhausted_at` et écrase l'estimation.

### G-17 — Lecteur persistant vs App Router (§7.1 `/lecture`)

Un `<iframe>` YouTube/Spotify est détruit à chaque navigation si le lecteur n'est pas monté
au-dessus des routes. _Résolution_ : lecteur monté dans le layout racine (client component

- store global), `/lecture` n'étant qu'une vue étendue du même lecteur. Contrainte
  d'architecture à respecter dès le Lot 3, pas au Lot 6.

### G-18 — Valeurs numériques absentes

Ni TTL de session, ni fenêtres de rate limit, ni rétention des `playback_events`, ni
seuil de fraîcheur d'une release (« périmée », §12.1) ne sont chiffrés.
_Défauts proposés_ : session glissante 30 j / absolue 90 j ; release périmée après 30 j ;
`playback_events` conservés 24 mois ; limites anti-abus dans `.env.example`.

### G-19 — Collection : dédup logique sous-spécifiée (COLL-005, §17.3)

Une tuile par édition avec `instanceCount`, mais le tri `date_added` sur plusieurs
exemplaires est ambigu. _Résolution_ : agrégation `MIN(date_added)` par édition,
documentée et testée.

### G-20 — Absence de contrat d'API transverse (§17)

Pas de version d'API, pas de schéma d'enveloppe, pas d'en-têtes de rate limit, pas de
mention explicite du cookie de session comme schéma d'authentification.
_Résolution_ : préfixe `/api/` non versionné en v0 (client unique), enveloppe d'erreur
§17.8 obligatoire partout, `X-RateLimit-*` sur les routes mutantes, `requestId` propagé
depuis le log.

### G-21 — Fixtures et droits de redistribution (§22.3) — [HUMAIN léger]

Les fixtures contiennent des données Discogs/YouTube réelles. Si le dépôt devient public,
vérifier les conditions. _Résolution_ : fixtures anonymisées et réduites, jamais de jeton,
note dans `tests/fixtures/README.md`.

---

## D. Manques mineurs, sans urgence

- `/api/me` : aucun schéma de réponse spécifié.
- Aucun seuil de couverture de tests ni budget de bundle chiffré (§22, §20.1).
- `discogs_releases.master_id` « informatif » : aucun usage v0 mais aucun garde-fou contre
  un couplage futur — à noter dans l'ADR MAP-009.
- §7.4 exige d'afficher « disponibilité YouTube et Spotify », ce qui contredit la
  résolution tardive (§4.2) : n'afficher que l'état **déjà connu** en base, jamais une sonde.
- Aucun écran d'erreur global ni page 404/500 spécifié.
- `encryption_key_version` existe (§10.1) mais la procédure de rotation de clé n'est
  décrite nulle part.
