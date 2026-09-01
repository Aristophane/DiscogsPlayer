# Discogs Player — Spécification produit et technique

> Version du document : 1.0  
> Date de référence : 2 septembre 2026  
> Statut : décisions v0 consolidées, prête pour implémentation  
> Langue produit initiale : français  
> Cible : application Web centralisée, responsive et installable en PWA

---

## 1. Rôle de ce document

Ce document est la source de vérité fonctionnelle et technique de Discogs Player. Il est conçu pour être donné intégralement à un LLM chargé de coder l’application, puis utilisé comme référence pendant les revues humaines.

Les termes suivants sont normatifs :

- **DOIT** : exigence obligatoire pour la version concernée ;
- **NE DOIT PAS** : comportement interdit ;
- **DEVRAIT** : recommandation forte, modifiable uniquement avec une raison documentée ;
- **PEUT** : comportement facultatif.

En cas d’ambiguïté pendant l’implémentation, le LLM doit :

1. préserver les décisions produit de ce document ;
2. choisir l’option la plus simple, réversible et testable ;
3. documenter l’hypothèse dans le journal de décision du dépôt ;
4. demander une décision humaine avant tout changement de périmètre, de fournisseur ou de modèle de confidentialité.

Le LLM ne doit pas transformer une fonctionnalité v1 ou v2 en dépendance de la v0.

---

## 2. Résumé du produit

Discogs Player permet à une personne de parcourir sa collection Discogs comme une bibliothèque musicale visuelle, puis d’écouter les albums qu’elle possède à l’aide de lecteurs distants.

La v0 utilise :

- **Discogs** pour l’identité, la collection, les éditions, les pochettes, les genres, les styles et les listes de pistes ;
- **YouTube** pour résoudre et lire des vidéos piste par piste ;
- **Spotify Embed** pour lire dans le site une piste, un album ou une playlist Spotify dont l’URL a été validée.

L’application apprend collectivement : une correspondance média corrigée par un utilisateur peut être confirmée par un autre, puis devenir la correspondance globale préférée pour les utilisateurs suivants.

Le cœur de la v0 est volontairement simple :

1. parcourir la collection sous forme de pochettes ;
2. tirer un album au hasard, éventuellement par genre et style ;
3. ouvrir un album et choisir une piste ;
4. résoudre cette piste seulement à cet instant ;
5. lire le média sans perdre le contexte de la collection.

---

## 3. Objectifs et non-objectifs

### 3.1 Objectifs v0

- Offrir une expérience mobile-first dominée par les pochettes.
- Supporter plusieurs utilisateurs dès le premier schéma de données.
- Utiliser le compte Discogs comme identité principale, sans mot de passe propre à l’application.
- Importer et synchroniser une collection Discogs de manière robuste et observable.
- Permettre la recherche locale par artiste, titre, genre et style.
- Proposer les modes Collection, Aléatoire et Aléatoire filtré.
- Lire YouTube dans l’application avec une résolution communautaire et économe en quota.
- Lire un album ou une piste Spotify dans l’application quand une URL Spotify est connue.
- Conserver les corrections partagées sans publier l’identité de leurs auteurs.
- Enregistrer quelques événements privés utiles à une future fonction de découverte.
- Rester fonctionnel lorsque les API externes sont ralenties ou que le quota YouTube est épuisé.

### 3.2 Non-objectifs v0

- Deezer, Qobuz et Apple Music.
- Utilisation de l’API de catalogue Spotify comme dépendance obligatoire.
- OAuth Spotify ou création automatique de playlists dans le compte Spotify.
- Création d’une file Spotify personnalisée fiable à partir de pistes indépendantes.
- Mode découverte ou recommandations algorithmiques.
- Réseau social, profils publics, commentaires ou abonnements entre utilisateurs.
- Application mobile native.
- Auto-hébergement par les utilisateurs.
- Paiement, abonnement ou publicité.
- Scraping de Google, YouTube, Spotify ou d’un moteur de recherche.
- Résolution en masse des médias pendant l’import de la collection.

### 3.3 Vision v1

La v1 étendra les fournisseurs et les fonctions de lecture sans remettre en cause le modèle central : une piste Discogs peut posséder plusieurs correspondances fournisseur indépendantes.

Les décisions v1 encore ouvertes sont listées en section 25.

### 3.4 Vision v2

La v2 ajoutera un mode découverte fondé sur :

- la collection Discogs ;
- les favoris explicites ;
- les lectures commencées et terminées ;
- les pistes passées.

Les comportements d’écoute resteront privés. Aucune donnée comportementale personnelle ne sera utilisée pour valider une correspondance globale.

---

## 4. Principes produit

1. **La pochette avant les métadonnées.** La collection doit donner l’impression de feuilleter des disques, pas d’administrer une base de données.
2. **Le média est résolu tardivement.** Aucune recherche YouTube ou Spotify n’est déclenchée tant que l’utilisateur n’a pas choisi un album ou une piste.
3. **Le connu passe avant le coûteux.** Une correspondance globale ou un lien Discogs existant est toujours essayé avant une API de recherche.
4. **L’incertitude est visible.** L’application ne lance automatiquement qu’une correspondance à forte confiance.
5. **Une erreur doit pouvoir être corrigée.** L’utilisateur peut toujours choisir un autre résultat ou coller une URL.
6. **Les corrections profitent à tous sans exposer leur auteur.**
7. **Un fournisseur ne contamine pas les autres.** Les identifiants et métadonnées Spotify restent dans le connecteur Spotify ; il en va de même pour YouTube.
8. **Une panne partielle ne bloque pas la bibliothèque.** Parcours, filtres, aléatoire et correspondances déjà connues restent disponibles.
9. **La v0 reste un monolithe modulaire.** Aucun microservice ni Redis n’est nécessaire.

---

## 5. Utilisateurs et rôles

### 5.1 Utilisateur

Peut :

- se connecter avec Discogs ;
- synchroniser sa collection ;
- parcourir, filtrer et rechercher ses albums ;
- utiliser les modes aléatoires ;
- écouter un média ;
- proposer ou confirmer une correspondance ;
- coller une URL YouTube ou Spotify ;
- marquer une piste comme favorite ;
- supprimer son compte et ses données personnelles.

### 5.2 Administrateur

Possède tous les droits utilisateur et peut :

- examiner les propositions signalées ou conflictuelles ;
- rejeter, restaurer ou désactiver une correspondance globale ;
- suspendre la capacité de contribution d’un compte abusif ;
- consulter les métriques de quota et de synchronisation ;
- consulter un journal d’audit sans accéder aux jetons externes.

Le rôle administrateur DOIT être attribué explicitement en base ou par une liste d’identifiants Discogs configurée. Il ne doit jamais être déduit du nom d’utilisateur affiché.

### 5.3 Travailleur système

Processus non humain chargé des imports, actualisations, validations différées et nettoyages. Il utilise la même base PostgreSQL que l’application Web.

---

## 6. Parcours principaux

### 6.1 Première connexion

1. L’utilisateur choisit « Se connecter avec Discogs ».
2. Il autorise l’application sur Discogs.
3. L’application récupère l’identité Discogs et crée ou retrouve le compte local.
4. L’import initial est créé en arrière-plan.
5. Une page de progression affiche le nombre d’éléments importés et permet de commencer à consulter les premiers albums déjà disponibles.
6. À la fin, l’utilisateur arrive dans sa collection.

### 6.2 Parcours Collection

1. La collection s’affiche comme une grille de pochettes carrées.
2. L’utilisateur peut rechercher ou filtrer.
3. Il touche une pochette.
4. La fiche album affiche la grande pochette, les informations discrètes et la liste des pistes.
5. Il choisit une piste ou lance l’album via Spotify si un album Spotify est associé.

### 6.3 Parcours Aléatoire

1. L’utilisateur ouvre Aléatoire.
2. Il peut conserver toute la collection ou choisir des genres et styles.
3. Il demande un tirage.
4. L’application affiche un album sans lancer de média.
5. Il ouvre l’album, choisit une piste ou demande un autre tirage.
6. Le même album ne réapparaît pas pendant la session avant épuisement de tous les albums éligibles.

### 6.4 Résolution YouTube

1. L’utilisateur sélectionne une piste.
2. L’application cherche une préférence propre à cet utilisateur.
3. Elle cherche la correspondance globale préférée pour cette édition et cette position de piste.
4. Elle examine les vidéos déjà fournies par Discogs.
5. Si nécessaire et si le quota le permet, elle exécute une recherche YouTube.
6. Une forte confiance lance le lecteur ; une confiance moyenne affiche 3 à 5 candidats.
7. L’utilisateur peut toujours choisir « Autre vidéo » ou coller une URL.

### 6.5 Résolution Spotify

1. L’application cherche d’abord une correspondance d’album Spotify pour l’édition Discogs.
2. Si elle existe, elle affiche un Embed d’album dans Discogs Player.
3. L’utilisateur choisit une piste dans cet Embed et Spotify enchaîne les pistes de l’album.
4. À défaut d’album, l’application cherche une correspondance Spotify de piste.
5. À défaut de correspondance, elle ouvre une recherche Spotify préremplie dans un nouvel onglet.
6. L’utilisateur copie le lien de l’album ou de la piste choisi et le colle dans Discogs Player.
7. L’application valide l’URL via oEmbed, affiche le lecteur et crée une proposition globale.

### 6.6 Quota YouTube épuisé

L’utilisateur peut toujours :

- parcourir et filtrer sa collection ;
- utiliser les modes aléatoires ;
- lire toutes les correspondances YouTube déjà connues ;
- utiliser les liens vidéo Discogs connus ;
- lire les Embeds Spotify connus ;
- ouvrir une recherche YouTube préremplie ;
- coller manuellement une URL YouTube.

Seule la création automatique de nouvelles recherches YouTube est désactivée.

---

## 7. Architecture de l’information et écrans

### 7.1 Routes Web recommandées

| Route                    | Fonction                                                  |
| ------------------------ | --------------------------------------------------------- |
| `/`                      | redirection vers la collection ou page d’accueil publique |
| `/connexion`             | connexion Discogs et explication des données utilisées    |
| `/import`                | progression de l’import initial                           |
| `/collection`            | grille, recherche, filtres et tri                         |
| `/aleatoire`             | filtres et session de tirage                              |
| `/sorties/[releaseId]`   | fiche d’une édition Discogs                               |
| `/lecture`               | lecteur persistant et file courante                       |
| `/parametres`            | synchronisation, confidentialité, suppression du compte   |
| `/aide/quotas`           | explication claire du quota YouTube                       |
| `/admin/correspondances` | modération des propositions                               |
| `/admin/systeme`         | synchronisations, erreurs et quotas                       |

### 7.2 Navigation mobile

Barre inférieure avec trois destinations principales :

- Collection ;
- Aléatoire ;
- Lecture en cours.

Les paramètres sont accessibles depuis l’avatar ou le menu supérieur. La navigation tablette peut devenir un rail latéral.

### 7.3 Grille de collection

- 2 colonnes sur petit mobile ;
- 3 colonnes sur mobile large ;
- 4 à 6 colonnes sur tablette selon la largeur ;
- rapport d’image carré réservé avant chargement ;
- titre et artiste sur deux lignes maximum sous la pochette ;
- chargement paresseux des images hors écran ;
- squelette respectant le ratio final ;
- pagination par curseur ou chargement progressif, jamais une liste DOM illimitée.

La pochette doit occuper la majorité de chaque tuile. Les badges, prix, statistiques et informations de marché Discogs sont hors périmètre.

### 7.4 Fiche album

Doit afficher :

- pochette principale ;
- artistes ;
- titre ;
- année et formats ;
- genres et styles ;
- édition Discogs concernée ;
- liste ordonnée des pistes avec position et durée si connue ;
- disponibilité YouTube et Spotify ;
- état de résolution et degré de confiance ;
- actions de correction.

---

## 8. Exigences fonctionnelles

### 8.1 Authentification

- **AUTH-001** — L’identité principale DOIT être le compte Discogs.
- **AUTH-002** — Le parcours normal DOIT utiliser OAuth Discogs.
- **AUTH-003** — Un jeton personnel Discogs PEUT être accepté uniquement en développement local.
- **AUTH-004** — L’application NE DOIT PAS gérer de mot de passe utilisateur.
- **AUTH-005** — Les jetons Discogs DOIVENT être chiffrés au repos.
- **AUTH-006** — La déconnexion invalide la session locale sans supprimer la collection.
- **AUTH-007** — Plusieurs comptes Discogs DOIVENT pouvoir cohabiter sans fuite de données.

### 8.2 Synchronisation

- **SYNC-001** — Un import complet est lancé après la première connexion.
- **SYNC-002** — Un bouton « Synchroniser » est toujours disponible.
- **SYNC-003** — Une actualisation automatique ne doit pas avoir lieu plus d’une fois par période de 24 heures par utilisateur.
- **SYNC-004** — Deux synchronisations du même compte ne doivent pas s’exécuter simultanément.
- **SYNC-005** — Les éléments supprimés de Discogs sont masqués de la collection locale après un import complet réussi.
- **SYNC-006** — Les correspondances globales et l’historique personnel ne sont pas supprimés lorsqu’un album quitte une collection.
- **SYNC-007** — Une synchronisation interrompue ne doit pas supprimer les éléments absents tant que toutes les pages n’ont pas été reçues.
- **SYNC-008** — Les limites Discogs doivent être pilotées par les en-têtes de rate limit et `Retry-After`, pas par une constante supposée.

### 8.3 Collection et recherche

- **COLL-001** — La collection locale doit pouvoir être parcourue sans nouvel appel Discogs.
- **COLL-002** — La recherche couvre au minimum artiste, titre d’album, genre et style.
- **COLL-003** — Les accents et la casse ne doivent pas empêcher une correspondance textuelle.
- **COLL-004** — Les genres et styles proviennent de l’édition Discogs.
- **COLL-005** — Deux exemplaires physiques d’une même édition restent deux instances de collection, mais une seule tuile logique par défaut.
- **COLL-006** — Une option discrète peut indiquer le nombre d’exemplaires sans augmenter la probabilité aléatoire.

### 8.4 Mode aléatoire

- **RAND-001** — Le tirage s’effectue parmi les éditions uniques éligibles.
- **RAND-002** — Un exemplaire en double n’augmente pas la probabilité.
- **RAND-003** — Aucun album ne se répète pendant une session avant épuisement.
- **RAND-004** — Les filtres Genre et Style sont combinables.
- **RAND-005** — Plusieurs valeurs d’un même type sont combinées par OU ; Genre et Style sont combinés entre eux par ET.
- **RAND-006** — Un tirage affiche l’album sans lancer automatiquement de média.
- **RAND-007** — À épuisement, l’application propose explicitement de recommencer une nouvelle session.

### 8.5 Lecture et file

- **PLAY-001** — Une piste choisie est suivie, lorsque le fournisseur le permet, par les pistes suivantes de l’album.
- **PLAY-002** — La file interne permet au minimum de retirer et réordonner les pistes.
- **PLAY-003** — YouTube peut utiliser la file interne piste par piste.
- **PLAY-004** — Un Embed Spotify d’album laisse Spotify gérer l’enchaînement interne de l’album.
- **PLAY-005** — L’application ne promet pas l’autoplay d’une file composée de plusieurs Embeds Spotify indépendants.
- **PLAY-006** — Un bouton « Ouvrir dans Spotify » reste disponible comme solution de repli.
- **PLAY-007** — Le lecteur ne doit jamais démarrer à la suite d’un simple tirage aléatoire.

### 8.6 Corrections communautaires

- **MAP-001** — Une correction s’applique immédiatement à l’utilisateur qui la soumet.
- **MAP-002** — Elle crée une proposition distincte sans écraser l’ancienne correspondance.
- **MAP-003** — Une confirmation par un autre utilisateur indépendant permet de la promouvoir comme préférence globale.
- **MAP-004** — Le soumissionnaire ne peut pas confirmer sa propre proposition.
- **MAP-005** — Un administrateur peut rejeter, désactiver ou restaurer une proposition.
- **MAP-006** — L’identité du contributeur n’est jamais affichée publiquement.
- **MAP-007** — La portée YouTube v0 est exactement `édition Discogs + position de piste`.
- **MAP-008** — La portée Spotify album v0 est exactement `édition Discogs`.
- **MAP-009** — Deux éditions Discogs du même album restent indépendantes en v0.
- **MAP-010** — Toute action de modération produit une trace d’audit.

### 8.7 Événements privés

Seuls les événements suivants sont requis :

- `playback_started` ;
- `track_completed` ;
- `track_skipped` ;
- `favorite_added` et son inverse `favorite_removed` pour maintenir l’état.

Les événements :

- sont privés ;
- ne participent pas aux votes de correspondance ;
- peuvent être supprimés avec le compte ;
- possèdent un identifiant d’idempotence afin d’éviter les doublons réseau.

---

## 9. Architecture technique

### 9.1 Stack

- TypeScript en mode strict ;
- Next.js avec App Router et composants serveur par défaut ;
- React pour les composants interactifs ;
- PostgreSQL ;
- Docker Compose en développement local ;
- Tailwind CSS ou CSS Modules avec tokens CSS centralisés ;
- Drizzle ORM recommandé pour garder un contrôle SQL explicite ;
- Zod pour valider toutes les frontières externes ;
- Vitest pour les tests unitaires et d’intégration ;
- React Testing Library pour les composants ;
- Playwright pour les parcours de bout en bout.

Les versions exactes doivent être les versions stables courantes au moment du démarrage, puis verrouillées dans le fichier de lock. Un LLM ne doit jamais inventer une API de bibliothèque : il doit consulter la version installée.

### 9.2 Forme du système

Monolithe modulaire déployé sous deux processus utilisant le même code :

```text
Navigateur / PWA
        |
        v
Next.js Web + routes serveur
        |
        +---------------------+
        |                     |
        v                     v
   PostgreSQL          APIs externes
        ^             Discogs / YouTube
        |             Spotify Embed/oEmbed
        |
Worker PostgreSQL
imports et maintenances
```

Il n’y a ni Redis, ni bus de messages, ni microservice en v0.

### 9.3 Modules applicatifs

```text
src/
  app/                 routes Next.js et écrans
  modules/
    auth/              OAuth Discogs, sessions, rôles
    catalog/           éditions, pistes, artistes, images
    collection/        instances, filtres, recherche
    sync/              imports et tâches PostgreSQL
    random/            sessions et tirages
    resolution/        orchestration des fournisseurs
    providers/
      youtube/         recherche, validation, lecteur
      spotify/         URL, oEmbed, lecteur
      discogs-video/   candidats issus des releases
    mappings/          propositions, confirmations, promotion
    playback/          lecteur, file, événements
    moderation/        administration et audit
    privacy/           export/suppression de compte
  db/                  schéma, migrations, requêtes
  lib/                 primitives partagées sans logique métier
  worker/              boucle de consommation des tâches
```

Les modules ne doivent pas appeler directement les tables appartenant à un autre module si un service métier existe déjà.

### 9.4 Tâches en base

Les tâches sont stockées dans PostgreSQL et consommées avec `FOR UPDATE SKIP LOCKED`.

Champs minimaux :

- `id` UUID ;
- `type` ;
- `payload` JSONB validé selon le type ;
- `status` : `queued`, `running`, `retry_wait`, `completed`, `failed`, `cancelled` ;
- `attempt_count` et `max_attempts` ;
- `run_after` ;
- `locked_at`, `locked_by` ;
- `last_error_code`, `last_error_message` nettoyé ;
- timestamps.

Le worker doit posséder :

- reprise des verrous expirés ;
- backoff exponentiel avec jitter ;
- idempotence métier ;
- arrêt propre ;
- limite de concurrence par fournisseur ;
- gestion spécifique des réponses 429.

---

## 10. Modèle de données

Tous les identifiants internes sont des UUID, sauf les identifiants fournisseurs conservés comme chaînes. Tous les timestamps sont en UTC.

### 10.1 Identité

#### `users`

- `id`
- `discogs_user_id` unique
- `discogs_username`
- `display_name` nullable
- `avatar_url` nullable
- `role` : `user` ou `admin`
- `contribution_status` : `active`, `limited`, `suspended`
- `locale` par défaut `fr`
- `created_at`, `updated_at`, `deleted_at`

#### `discogs_credentials`

- `user_id` unique
- `access_token_ciphertext`
- `access_token_secret_ciphertext`
- `encryption_key_version`
- `created_at`, `updated_at`

#### `sessions`

- `id`
- `user_id`
- `token_hash` unique
- `expires_at`
- `last_seen_at`
- `revoked_at`
- informations minimales de sécurité, sans empreinte intrusive

### 10.2 Catalogue Discogs

#### `discogs_releases`

- `id` interne
- `discogs_release_id` unique
- `master_id` nullable, informatif seulement en v0
- `title`
- `year` nullable
- `country` nullable
- `formats` JSONB
- `genres` tableau texte
- `styles` tableau texte
- `primary_image_url` nullable
- `raw_source_updated_at` nullable
- `details_fetched_at`
- `created_at`, `updated_at`

Indexes GIN sur `genres` et `styles`, index de recherche textuelle sur titre et artistes dénormalisés ou vue dédiée.

#### `discogs_artists`

- `id`
- `discogs_artist_id` nullable
- `name`
- `name_normalized`

#### `discogs_release_artists`

- `release_id`
- `artist_id`
- `position`
- `join_text` nullable

#### `discogs_tracks`

- `id`
- `release_id`
- `discogs_position` chaîne, par exemple `A1`, `1-03`
- `ordinal` entier déterminé pour l’ordre local
- `title`
- `title_normalized`
- `duration_seconds` nullable
- `type` : `track`, `heading`, `index`
- `extra_artists` JSONB minimal

Contrainte unique recommandée : `(release_id, discogs_position, ordinal)`. Les headings ne sont pas lisibles.

#### `discogs_release_videos`

- `id`
- `release_id`
- `url_canonical`
- `provider` généralement `youtube`
- `external_id` nullable
- `title` nullable
- `duration_seconds` nullable
- `fetched_at`

### 10.3 Collections

#### `collection_instances`

- `id`
- `user_id`
- `release_id`
- `discogs_instance_id`
- `discogs_folder_id`
- `rating` nullable
- `date_added` nullable
- `is_active`
- `last_seen_sync_id`
- `created_at`, `updated_at`, `removed_at`

Contrainte unique : `(user_id, discogs_instance_id)`.

#### `sync_runs`

- `id`
- `user_id`
- `kind` : `initial`, `manual`, `scheduled`
- `status`
- `pages_total`, `pages_processed`
- `items_seen`, `items_changed`
- `started_at`, `completed_at`
- `error_code` nullable

Une contrainte ou un verrou applicatif empêche deux runs actifs pour le même utilisateur.

### 10.4 Résolution et corrections

#### `provider_entities`

- `id`
- `provider` : `youtube`, `spotify`
- `entity_type` : `video`, `track`, `album`, `playlist`
- `external_id`
- `canonical_url`
- `title_cache` nullable
- `artist_cache` nullable
- `duration_seconds_cache` nullable
- `thumbnail_url_cache` nullable
- `metadata_fetched_at` nullable
- `metadata_expires_at` nullable
- `availability_status` : `unknown`, `available`, `unavailable`, `region_limited`
- `last_validated_at` nullable

Contrainte unique : `(provider, entity_type, external_id)`.

Les métadonnées fournisseur sont des caches, jamais la source canonique du catalogue interne.

#### `mapping_proposals`

- `id`
- `provider_entity_id`
- `scope_type` : `release_track` ou `release`
- `release_id`
- `track_id` nullable selon la portée
- `submitted_by_user_id` nullable après anonymisation
- `source` : `automatic`, `discogs_video`, `manual_url`, `admin`
- `confidence_score` entre 0 et 1
- `status` : `pending`, `preferred`, `rejected`, `disabled`, `superseded`
- `created_at`, `updated_at`

#### `mapping_confirmations`

- `proposal_id`
- `user_id` nullable après anonymisation du compte
- `decision` : `confirm` ou `reject`
- `created_at`

Contrainte unique tant que l’auteur existe : `(proposal_id, user_id)`. Une règle métier interdit au soumissionnaire de voter. Lors d’une suppression de compte, la décision peut rester agrégée et auditée, mais son lien vers l’utilisateur est supprimé de manière irréversible.

#### `user_mapping_preferences`

- `user_id`
- portée identique à la proposition
- `provider`
- `proposal_id`
- `created_at`, `updated_at`

Cette table rend une correction immédiatement active pour son auteur avant sa promotion globale.

#### `moderation_actions`

- `id`
- `admin_user_id`
- `proposal_id` nullable
- `target_user_id` nullable
- `action`
- `reason_code`
- `note` nullable
- `created_at`

### 10.5 Lecture

#### `playback_sessions`

- `id`
- `user_id`
- `provider`
- `release_id` nullable
- `started_at`, `ended_at`

#### `playback_queue_items`

- `id`
- `session_id`
- `track_id`
- `provider_entity_id` nullable
- `position`
- `status` : `queued`, `playing`, `completed`, `skipped`, `removed`, `failed`

#### `playback_events`

- `id`
- `idempotency_key` unique par utilisateur
- `user_id`
- `session_id` nullable
- `track_id`
- `provider`
- `event_type`
- `occurred_at`
- `context` JSONB limité et validé

#### `user_favorites`

- `user_id`
- `track_id`
- `created_at`

Contrainte unique : `(user_id, track_id)`.

### 10.6 Aléatoire et quotas

#### `random_sessions`

- `id`
- `user_id`
- `filter_genres` tableau
- `filter_styles` tableau
- `eligible_count`
- `created_at`, `completed_at`

#### `random_session_releases`

- `session_id`
- `release_id`
- `drawn_at`
- `draw_order`

Contrainte unique : `(session_id, release_id)`.

#### `provider_quota_windows`

- `provider`
- `operation`, par exemple `youtube.search.list`
- `window_start`
- `window_end`
- `configured_limit`
- `estimated_used`
- `reported_used` nullable
- `exhausted_at` nullable
- `updated_at`

Mise à jour atomique obligatoire avant tout appel consommateur.

---

## 11. Authentification Discogs et sessions

Discogs utilise un parcours OAuth 1.0a. Le serveur doit :

1. demander un request token avec une URL de callback explicite ;
2. conserver temporairement le request token secret côté serveur ;
3. rediriger l’utilisateur vers Discogs ;
4. vérifier le callback et échanger le verifier contre un access token ;
5. appeler l’endpoint d’identité Discogs ;
6. créer ou mettre à jour le compte local ;
7. émettre une session locale opaque.

La session recommandée est un jeton aléatoire de forte entropie :

- valeur brute uniquement dans un cookie `HttpOnly`, `Secure` en production, `SameSite=Lax` ;
- hash du jeton uniquement en base ;
- rotation après authentification ;
- expiration glissante bornée ;
- révocation lors de la déconnexion ou suppression du compte.

Le request token secret ne doit jamais être envoyé au client en clair. Le callback doit être protégé contre la fixation de session et les callbacks expirés.

---

## 12. Import et synchronisation Discogs

### 12.1 Algorithme

1. Créer un `sync_run` idempotent.
2. Charger la collection depuis le dossier Discogs « All » avec la pagination maximale autorisée.
3. Pour chaque instance :
   - upsert l’édition sommaire ;
   - upsert l’instance de collection ;
   - marquer `last_seen_sync_id` ;
   - créer une tâche de détail si l’édition est inconnue ou périmée.
4. Les tâches de détail chargent tracklist, images, genres, styles, artistes et vidéos.
5. Après réception réussie de toutes les pages, désactiver les instances actives non vues pendant ce run.
6. Marquer le run terminé et enregistrer les compteurs.

### 12.2 Déduplication globale

Une édition Discogs identique dans plusieurs collections ne doit être chargée en détail qu’une fois. Les tâches de détail sont uniques par `discogs_release_id` et fenêtre de fraîcheur.

### 12.3 Tolérance aux pannes

- Respecter `Retry-After`.
- Utiliser les en-têtes Discogs de limite restante.
- Arrêter temporairement les appels avant d’atteindre zéro.
- Reprendre à la dernière page confirmée.
- Ne jamais interpréter une page en erreur comme une page vide.
- Afficher un statut compréhensible : en attente, import en cours, ralenti par Discogs, terminé, erreur récupérable.

---

## 13. Résolution YouTube

### 13.1 Ordre strict des sources

1. préférence utilisateur ;
2. proposition globale préférée ;
3. candidats issus de `release.videos` Discogs ;
4. recherche automatique YouTube si quota disponible ;
5. recherche Web YouTube préremplie et collage manuel.

L’import Discogs ne déclenche jamais une recherche YouTube.

### 13.2 Requête

La requête de base combine :

```text
{artiste principal} {titre de piste} {titre album} {année facultative}
```

Une seule requête `search.list` doit normalement suffire. Le nombre de résultats demandé est limité aux candidats utiles, par exemple 10. Une deuxième page n’est demandée qu’après une action explicite de l’utilisateur, car chaque page consomme un appel supplémentaire.

### 13.3 Quota

À la date de ce document, YouTube attribue par défaut :

- 100 appels `search.list` par jour et par projet Google Cloud ;
- un compartiment séparé de 10 000 unités par jour pour les autres endpoints courants ;
- réinitialisation quotidienne à minuit, heure du Pacifique.

Ces valeurs doivent être configurables et non codées en dur, car Google peut les modifier. La clé API est commune à l’application ; connecter un utilisateur à son compte Google ne multiplie pas le quota du projet.

L’interface affiche :

- le nombre estimé de recherches restantes ;
- le caractère global du quota ;
- l’heure locale estimée de réinitialisation ;
- une explication lorsqu’une erreur API rend l’estimation incertaine.

L’heure de réinitialisation est calculée dans le fuseau `America/Los_Angeles`, puis convertie dans le fuseau du navigateur.

### 13.4 Recherche manuelle

Le bouton de repli ouvre :

```text
https://www.youtube.com/results?search_query={requête encodée}
```

Le navigateur ne peut pas connaître de manière fiable la vidéo choisie sur youtube.com. L’utilisateur doit copier ou partager l’URL vers Discogs Player. Le collage est validé côté serveur.

### 13.5 Validation et canonicalisation

Accepter uniquement les formes officielles reconnues, notamment :

- `youtube.com/watch?v=...` ;
- `youtu.be/...` ;
- éventuellement les URLs Shorts si elles identifient une vidéo lisible dans l’Embed.

Extraire l’identifiant, supprimer les paramètres de pistage et reconstruire une URL canonique. Refuser toute autre origine. Vérifier la disponibilité par `videos.list` lorsque possible.

### 13.6 Lecteur

Utiliser l’IFrame Player API officielle. Les événements du lecteur alimentent la file et les événements privés.

Quand une piste se termine :

- passer à l’élément suivant de la file interne ;
- si le suivant n’est pas résolu, lancer son pipeline de résolution ;
- ne jamais lancer en parallèle plusieurs recherches sans action ou besoin immédiat.

### 13.7 Conservation des données YouTube

- Le `videoId`, l’URL canonique et la relation corrigée sont conservés pour fournir la fonctionnalité.
- Les métadonnées obtenues via l’API sont traitées comme un cache avec une date d’expiration.
- Les données périmées sont actualisées ou supprimées conformément aux politiques YouTube en vigueur.
- Une vidéo supprimée ou non intégrable désactive la proposition sans effacer son historique d’audit.

---

## 14. Résolution Spotify sans Web API obligatoire

### 14.1 Principe

La v0 utilise les Embeds Spotify et oEmbed, pas le catalogue Web API comme dépendance principale. Cela évite de conditionner le produit public aux restrictions du mode développeur Spotify.

### 14.2 Ordre des sources

1. préférence utilisateur d’album ;
2. correspondance globale préférée d’album ;
3. préférence ou correspondance globale de piste ;
4. recherche Spotify préremplie ;
5. collage manuel d’une URL.

### 14.3 Recherche manuelle

Construire une URL de recherche à partir d’artiste, album et éventuellement année :

```text
https://open.spotify.com/search/{requête encodée}
```

Cette route Web est un repli best-effort : elle est isolée dans le connecteur Spotify afin de pouvoir être modifiée sans toucher au domaine.

### 14.4 URLs acceptées

- `https://open.spotify.com/album/{id}` ;
- `https://open.spotify.com/track/{id}` ;
- `https://open.spotify.com/playlist/{id}` uniquement si une fonction future le demande ;
- liens courts Spotify après résolution serveur contrôlée.

Supprimer les paramètres de pistage et conserver l’identifiant et le type. Ne suivre une redirection que vers une origine Spotify autorisée, avec limite de redirections et timeout, afin d’éviter les SSRF.

### 14.5 Validation

Interroger l’endpoint oEmbed officiel avec l’URL canonique. Une réponse valide fournit le code Embed et des métadonnées d’affichage temporaires. Le serveur ne doit pas rendre aveuglément du HTML reçu : utiliser un composant iframe construit à partir du type et de l’identifiant validés.

### 14.6 Lecture d’album

La correspondance d’album est privilégiée car elle répond au parcours produit :

- le lecteur reste dans Discogs Player ;
- l’utilisateur choisit la piste dans l’album ;
- Spotify peut enchaîner les pistes de cet album ;
- les événements iFrame peuvent indiquer le début de chaque piste.

La correspondance exacte entre positions Discogs et Spotify n’est pas supposée : bonus tracks, remasters et éditions différentes peuvent diverger.

### 14.7 Limites affichées honnêtement

- Selon le navigateur, le compte, le territoire et les droits, l’Embed peut fournir une lecture limitée ou un extrait.
- L’autoplay programmatique n’est pas garanti sur tous les navigateurs.
- Une file interne de pistes Spotify indépendantes ne doit pas être présentée comme fiable en v0.
- « Ouvrir dans Spotify » reste toujours accessible.

### 14.8 Séparation des fournisseurs

Les métadonnées Spotify :

- ne servent pas à construire les recherches YouTube ;
- ne deviennent pas le catalogue canonique de l’application ;
- sont attribuées et liées à Spotify lorsqu’elles sont affichées ;
- sont conservées uniquement aussi longtemps que nécessaire au fonctionnement et selon les conditions Spotify.

---

## 15. Algorithme de confiance

Le score automatique doit être déterministe, testable et explicable. Proposition initiale :

| Signal                         | Poids indicatif |
| ------------------------------ | --------------: |
| similarité artiste             |            0,30 |
| similarité titre de piste      |            0,35 |
| similarité album               |            0,10 |
| proximité de durée             |            0,15 |
| signaux de source/chaîne/titre |            0,10 |

Les poids sont configurables et versionnés. La proposition conserve la version de l’algorithme utilisée.

### 15.1 Normalisation

- Unicode normalisé ;
- casse ignorée ;
- espaces et ponctuation normalisés ;
- marqueurs de featuring comparés sans être entièrement supprimés ;
- suffixes comme « remastered », « live », « edit », « mix » conservés comme signaux sémantiques ;
- aucun modèle d’IA externe nécessaire en v0.

### 15.2 Signaux négatifs YouTube

Pénaliser fortement lorsque ces termes ne sont pas présents dans la piste Discogs :

- live ;
- cover ;
- karaoke ;
- reaction ;
- tutorial ;
- slowed, sped up ;
- remix, edit, remaster incompatible ;
- full album pour une piste individuelle.

### 15.3 Seuils initiaux

- `score >= 0,86` et aucun conflit fort : lecture directe ;
- `0,65 <= score < 0,86` : afficher 3 à 5 candidats ;
- `score < 0,65` : ne rien lancer automatiquement, proposer la recherche manuelle.

Ces valeurs doivent être évaluées avec un jeu de fixtures avant production. Une validation humaine reste toujours possible.

---

## 16. Promotion des corrections

### 16.1 Cycle de vie

```text
soumission
   |
   +--> préférence immédiate du soumissionnaire
   |
   v
pending --confirmation indépendante--> preferred
   |                                    |
   +--rejet admin--> rejected           +--invalidité--> disabled
```

### 16.2 Conflits

Plusieurs propositions peuvent coexister pour la même portée. Une seule est préférée globalement à un instant donné par fournisseur.

Lorsqu’une nouvelle proposition atteint le seuil :

- elle ne supprime pas l’ancienne ;
- l’ancienne devient `superseded` ou reste candidate selon la règle de score ;
- l’action est auditée ;
- un administrateur peut restaurer l’ancienne.

### 16.3 Prévention des abus

- limite de soumissions par utilisateur et par fenêtre ;
- confirmation impossible entre comptes identiques ;
- conservation interne de l’auteur tant que le compte existe ;
- compteur de propositions rejetées ;
- suspension ciblée de la contribution sans bloquer la lecture ;
- aucun pseudonyme public.

---

## 17. API serveur interne

Les routes utilisent JSON, des erreurs structurées et une validation Zod. Elles ne renvoient jamais un secret fournisseur.

### 17.1 Authentification

```text
GET  /api/auth/discogs/start
GET  /api/auth/discogs/callback
POST /api/auth/logout
GET  /api/me
```

### 17.2 Synchronisation

```text
POST /api/sync-runs
GET  /api/sync-runs/current
GET  /api/sync-runs/{id}
```

`POST /api/sync-runs` retourne `202 Accepted` avec l’identifiant du run ou le run déjà actif.

### 17.3 Collection

```text
GET /api/collection?cursor=&query=&genres=&styles=&sort=
GET /api/releases/{discogsReleaseId}
```

La réponse Collection contient des éditions logiques et `instanceCount`, pas une tuile par exemplaire.

### 17.4 Aléatoire

```text
POST /api/random-sessions
POST /api/random-sessions/{id}/draws
GET  /api/random-sessions/{id}
```

Création :

```json
{
  "genres": ["Electronic"],
  "styles": ["Ambient", "IDM"]
}
```

### 17.5 Résolution

```text
POST /api/resolutions/youtube
POST /api/resolutions/spotify
POST /api/provider-urls/validate
GET  /api/quotas/youtube
```

Exemple YouTube :

```json
{
  "releaseId": "uuid",
  "trackId": "uuid"
}
```

Réponse possible :

```json
{
  "status": "candidates",
  "source": "youtube_search",
  "candidates": [
    {
      "proposalId": "uuid",
      "provider": "youtube",
      "entityType": "video",
      "canonicalUrl": "https://www.youtube.com/watch?v=...",
      "title": "...",
      "confidence": 0.78,
      "reasons": ["artist_exact", "duration_close"]
    }
  ],
  "quota": {
    "remainingEstimated": 42,
    "resetsAt": "2026-09-03T07:00:00Z"
  }
}
```

### 17.6 Corrections

```text
POST /api/mapping-proposals
POST /api/mapping-proposals/{id}/confirmations
DELETE /api/user-mapping-preferences/{id}
POST /api/admin/mapping-proposals/{id}/actions
```

### 17.7 Lecture

```text
POST  /api/playback-sessions
PATCH /api/playback-sessions/{id}/queue
POST  /api/playback-events
PUT   /api/favorites/{trackId}
DELETE /api/favorites/{trackId}
```

### 17.8 Erreurs

Format commun :

```json
{
  "error": {
    "code": "YOUTUBE_SEARCH_QUOTA_EXHAUSTED",
    "message": "La recherche automatique YouTube est momentanément indisponible.",
    "retryable": true,
    "retryAt": "2026-09-03T07:00:00Z",
    "requestId": "uuid"
  }
}
```

Les messages utilisateurs sont localisés. Les détails techniques restent dans les logs serveur.

---

## 18. Sécurité

### 18.1 Secrets

- Secrets Discogs, clé YouTube et clé de chiffrement uniquement côté serveur.
- Aucun secret avec préfixe public Next.js.
- Chiffrement applicatif AES-256-GCM ou service de gestion de clés équivalent.
- Version de clé enregistrée pour permettre la rotation.
- Aucun jeton dans les logs, traces, URLs ou outils analytiques.

### 18.2 Requêtes mutantes

- Vérifier session, rôle et propriété de la ressource.
- Protéger contre CSRF avec token ou vérification stricte `Origin`/`Host` et cookies SameSite.
- Utiliser des clés d’idempotence pour synchronisations, corrections et événements.
- Limiter le débit par utilisateur et, pour les routes publiques, par IP hachée à courte durée.

### 18.3 URLs externes et SSRF

- Allowlist d’origines exacte.
- Parsing avec l’API URL, jamais par concaténation naïve.
- DNS et redirections contrôlés pour les liens courts.
- Timeouts courts et taille de réponse limitée.
- Aucun téléchargement arbitraire depuis une URL utilisateur.

### 18.4 Contenu et XSS

- Échapper toutes les chaînes Discogs et fournisseur.
- Ne jamais injecter directement le HTML oEmbed.
- Construire les iframes depuis des identifiants validés.
- Politique CSP incluant seulement les domaines nécessaires.
- `frame-src` limité à YouTube et Spotify officiels.

### 18.5 Isolation multi-utilisateur

Chaque requête de collection, événement, préférence ou session doit filtrer par `user_id` obtenu depuis la session serveur. Un identifiant utilisateur fourni par le client ne constitue jamais une autorisation.

---

## 19. Confidentialité et suppression de compte

### 19.1 Données privées

- jetons Discogs ;
- collection active ;
- historique d’écoute ;
- favoris ;
- sessions aléatoires ;
- préférences personnelles ;
- identifiant interne des contributions avant anonymisation.

### 19.2 Suppression

Lorsqu’un utilisateur supprime son compte :

1. révoquer toutes ses sessions ;
2. supprimer ses credentials Discogs ;
3. supprimer ou dissocier sa collection ;
4. supprimer événements, favoris et préférences privés ;
5. anonymiser les propositions globales utiles en mettant leur auteur à `NULL` ou vers un auteur système non réversible ;
6. conserver les correspondances et actions nécessaires à l’intégrité globale ;
7. enregistrer uniquement une preuve technique minimale de traitement si la loi l’exige.

La suppression doit être asynchrone mais visible, idempotente et achevée dans un délai documenté.

### 19.3 Consentement et transparence

La première connexion explique :

- quelles données Discogs sont importées ;
- pourquoi des événements d’écoute privés sont enregistrés ;
- comment les corrections sont anonymisées et partagées ;
- comment supprimer le compte.

---

## 20. Performance, accessibilité et PWA

### 20.1 Performance

- Rendu serveur de la première page de collection.
- Images dimensionnées et paresseuses.
- Pas de chargement des scripts YouTube ou Spotify avant l’affichage d’un lecteur.
- Recherche locale PostgreSQL, pas Discogs à chaque frappe.
- Debounce de recherche côté client et annulation des requêtes obsolètes.
- Pagination par curseur.
- Objectif LCP mobile au 75e percentile inférieur à 2,5 s dans des conditions raisonnables.
- CLS inférieur à 0,1 grâce aux dimensions réservées.

### 20.2 Accessibilité

- Navigation complète au clavier.
- Focus visible.
- Nom accessible pour chaque pochette et chaque contrôle lecteur.
- Contraste WCAG AA.
- Réduction des animations selon `prefers-reduced-motion`.
- États de chargement annoncés sans interrompre la lecture.
- La couleur n’est jamais le seul indicateur de confiance ou d’erreur.
- Les iframes possèdent un titre explicite.

### 20.3 PWA

- Manifest, icônes et couleurs de thème.
- Installation sur écran d’accueil.
- Cache du shell et des ressources statiques.
- Ne pas mettre en cache publiquement les réponses de collection privées.
- En mode hors ligne, afficher la dernière collection locale déjà rendue uniquement si un stockage privé explicite est implémenté ; sinon fournir une page hors ligne claire.
- La lecture en arrière-plan ou écran verrouillé n’est pas garantie en v0.

---

## 21. Observabilité et exploitation

### 21.1 Logs structurés

Inclure :

- `request_id` ;
- module ;
- route ou type de tâche ;
- résultat et durée ;
- identifiant utilisateur pseudonymisé ;
- fournisseur ;
- code d’erreur externe nettoyé.

Exclure : jetons, cookies, secrets, contenu complet des callbacks OAuth et données personnelles inutiles.

### 21.2 Métriques minimales

- connexions Discogs réussies/échouées ;
- durée et taux d’échec des synchronisations ;
- backlog et âge des tâches ;
- limites Discogs restantes observées ;
- recherches YouTube consommées et restantes estimées ;
- taux de cache global ;
- part Discogs videos / YouTube API / manuel ;
- scores de candidats acceptés ou corrigés ;
- Embeds Spotify valides/invalides ;
- propositions en attente et rejetées ;
- erreurs de lecture par fournisseur.

### 21.3 Alertes

- worker sans heartbeat ;
- tâches bloquées ;
- augmentation d’erreurs OAuth ;
- quota YouTube épuisé anormalement tôt ;
- taux élevé de vidéos devenues indisponibles ;
- migrations non appliquées ;
- espace disque PostgreSQL faible.

---

## 22. Tests

### 22.1 Unitaires

- normalisation artiste/titre ;
- parsing des durées Discogs ;
- scoring et seuils ;
- extraction et canonicalisation YouTube ;
- extraction et canonicalisation Spotify ;
- calcul du prochain minuit Pacifique avec changements d’heure ;
- compteur de quota atomique ;
- règles de confirmation indépendante ;
- filtres Genre/Style ;
- absence de répétition aléatoire ;
- exemplaires multiples sans pondération.

### 22.2 Intégration

- OAuth Discogs avec serveur simulé ;
- import paginé et reprise ;
- absence de suppression après page en erreur ;
- déduplication des détails d’une édition entre utilisateurs ;
- verrouillage concurrent des tâches ;
- promotion transactionnelle d’une proposition ;
- isolation multi-utilisateur ;
- suppression et anonymisation du compte ;
- quota épuisé avec correspondance globale toujours disponible.

### 22.3 Contrats fournisseurs

Conserver des fixtures nettoyées représentant :

- identité Discogs ;
- page de collection avec doublons ;
- release avec headings, index tracks et vidéos ;
- recherche YouTube ;
- vidéo privée, supprimée ou non intégrable ;
- oEmbed Spotify album et track ;
- erreurs 401, 403, 404, 429 et 5xx.

Les tests CI ne doivent appeler aucune API réelle.

### 22.4 Bout en bout

1. connexion et import initial ;
2. affichage progressif de la collection ;
3. recherche par artiste ;
4. aléatoire sans répétition ;
5. aléatoire Genre + Style ;
6. lecture d’une correspondance YouTube connue ;
7. sélection parmi candidats incertains ;
8. quota épuisé puis collage manuel ;
9. collage d’un album Spotify puis Embed ;
10. correction immédiate pour l’auteur ;
11. confirmation indépendante puis promotion globale ;
12. retrait par administrateur ;
13. suppression du compte.

### 22.5 Accessibilité et visuel

- Axe sans violation critique sur les écrans principaux ;
- captures mobiles et tablettes ;
- vérification avec textes longs et pochettes manquantes ;
- focus et lecteur testés au clavier ;
- thème clair ou sombre cohérent si les deux sont implémentés.

---

## 23. Développement local et configuration

### 23.1 Services Docker Compose

- `postgres` ;
- `web` facultatif en conteneur, sinon lancé sur l’hôte ;
- `worker` facultatif en conteneur, sinon lancé sur l’hôte.

### 23.2 Variables d’environnement

```text
DATABASE_URL=
APP_BASE_URL=
SESSION_SECRET=
CREDENTIAL_ENCRYPTION_KEY=
DISCOGS_CONSUMER_KEY=
DISCOGS_CONSUMER_SECRET=
DISCOGS_PERSONAL_TOKEN=            # développement uniquement
YOUTUBE_API_KEY=
YOUTUBE_SEARCH_DAILY_LIMIT=100
YOUTUBE_GENERAL_DAILY_LIMIT=10000
ADMIN_DISCOGS_USER_IDS=
LOG_LEVEL=info
```

Fournir `.env.example` sans valeur sensible et valider l’environnement au démarrage.

### 23.3 Mode fournisseurs simulés

Un mode local doit permettre de développer sans clés :

- fixtures Discogs ;
- faux résultats YouTube ;
- faux quota ;
- URLs Spotify de test validées par fixtures ;
- latence et erreurs injectables.

Ce mode ne doit pas utiliser de branches métier différentes : seuls les adaptateurs externes sont remplacés.

---

## 24. Plan d’implémentation pour un LLM

Chaque lot doit produire code, migration, tests, documentation et preuve de vérification. Ne pas construire plusieurs lots sans valider le précédent.

### Lot 0 — Fondation

- Initialiser Git, Next.js, TypeScript strict et le lockfile.
- Ajouter Docker Compose PostgreSQL.
- Installer et configurer l’ORM, les tests et le lint.
- Ajouter validation d’environnement, logs et `/api/health`.
- Créer les conventions de modules et le journal ADR.

**Terminé quand :** application et PostgreSQL démarrent avec une seule procédure documentée ; lint, typecheck et test minimal passent.

### Lot 1 — Identité Discogs

- Schéma users, credentials et sessions.
- OAuth Discogs complet.
- Chiffrement des credentials.
- Middleware d’authentification et rôles.
- Connexion, callback, déconnexion et page paramètres minimale.

**Terminé quand :** deux comptes simulés restent isolés et une session révoquée ne fonctionne plus.

### Lot 2 — Import et catalogue

- Schéma catalogue, collection, tâches et sync runs.
- Worker `SKIP LOCKED`.
- Pagination Discogs, reprise et rate limits.
- Import des détails, tracklists, genres, styles, images et vidéos.
- Écran de progression.

**Terminé quand :** une collection paginée avec doublons est importée, reprise après erreur et synchronisée sans suppression prématurée.

### Lot 3 — Expérience Collection

- Grille mobile-first.
- Pagination, recherche et filtres.
- Fiche album et piste.
- États vide, chargement, erreur et pochette absente.

**Terminé quand :** les budgets d’accessibilité et les captures mobile/tablette sont validés.

### Lot 4 — Aléatoire

- Sessions persistées.
- Filtres Genre/Style.
- Tirage parmi éditions uniques.
- Épuisement et redémarrage.

**Terminé quand :** les tests prouvent l’absence de répétition et de pondération par exemplaires.

### Lot 5 — Correspondances communautaires

- Entités fournisseur, propositions, confirmations, préférences et audit.
- Promotion transactionnelle après confirmation indépendante.
- Interfaces de correction et modération.
- Limites anti-abus.

**Terminé quand :** la correction est immédiate pour l’auteur, non globale avant confirmation, globale après confirmation et réversible par admin.

### Lot 6 — YouTube

- Import des vidéos Discogs comme candidats.
- Orchestrateur de résolution.
- Scoring déterministe.
- Quota atomique et écran d’information.
- Recherche, candidats, collage manuel et IFrame Player.
- File des pistes suivantes de l’album.

**Terminé quand :** aucun appel de recherche n’a lieu avant sélection, et tous les replis fonctionnent quota épuisé.

### Lot 7 — Spotify Embed

- Canonicalisation album/track.
- Validation oEmbed.
- Recherche préremplie et collage.
- Correspondance d’album prioritaire.
- Lecteur Embed, événements disponibles et bouton d’ouverture externe.

**Terminé quand :** un album validé se lit dans le site et une absence d’Embed produit un repli explicite.

### Lot 8 — Événements, confidentialité et durcissement

- Événements privés et favoris.
- Suppression/anonymisation du compte.
- CSP, CSRF, rate limits et vérification SSRF.
- Métriques, alertes et administration système.
- Manifest PWA, performance et accessibilité finale.

**Terminé quand :** tous les parcours E2E, le contrôle de sécurité et la procédure de restauration passent.

### Discipline de travail du LLM

Pour chaque lot, le LLM doit :

1. lire ce document et les instructions du dépôt ;
2. inspecter l’existant avant toute modification ;
3. proposer un plan court et une liste de fichiers concernés ;
4. créer une migration additive et réversible ;
5. écrire les tests avant ou avec la logique ;
6. ne jamais appeler une API réelle en CI ;
7. exécuter formatage, lint, typecheck, tests et build ;
8. signaler toute divergence ou politique externe nouvelle ;
9. mettre à jour le journal ADR si une décision technique importante change ;
10. livrer un résumé des risques restants, sans déclarer terminé ce qui n’a pas été vérifié.

---

## 25. Questions restantes pour la v1

Aucune de ces questions ne bloque le codage de la v0. Elles doivent être tranchées avant de figer le périmètre v1.

### 25.1 Fournisseurs

1. **Quels fournisseurs la v1 doit-elle réellement ajouter ?** Deezer, Qobuz et Apple Music sont exclus de la v0, mais faut-il les reconsidérer en v1 ou conserver seulement YouTube + Spotify ?
2. **Qu’appelle-t-on “supporter un fournisseur” ?** Lecteur intégré, contrôle d’une application distante, simple lien externe, export de playlist, ou plusieurs niveaux clairement distingués ?
3. **Accepte-t-on qu’un fournisseur soit disponible seulement dans certains pays ou pour certains abonnements ?**

### 25.2 Spotify avancé

4. **La v1 doit-elle connecter le compte Spotify de l’utilisateur ?** Cela permettrait de créer des playlists et de contrôler certaines lectures, mais introduit OAuth, scopes, conformité et contraintes d’accès public.
5. **La création de playlists Spotify est-elle une exigence v1 ou seulement une amélioration opportuniste ?**
6. **Quelle stratégie adopter si l’accès étendu Spotify n’est pas obtenu ?** Maintenir uniquement les Embeds, lancer la v1 sans Spotify avancé, ou rechercher un partenariat ?

### 25.3 Modèle musical commun

7. **Faut-il introduire une entité “enregistrement canonique” indépendante des éditions ?** Elle permettrait de partager une correspondance entre plusieurs éditions, mais nécessite une source neutre et des règles complexes pour remasters, mixes et versions live.
8. **Utilise-t-on MusicBrainz, ISRC ou une autre source neutre pour cette normalisation ?** Une étude de qualité, licence, couverture et quotas est nécessaire.
9. **Quand deux éditions peuvent-elles partager une correspondance ?** Même ISRC, même durée et titre, validation humaine, ou combinaison de signaux ?

### 25.4 Playlists et priorité des fournisseurs

10. **La playlist est-elle interne à Discogs Player, exportée vers un fournisseur, ou synchronisée dans les deux sens ?**
11. **L’utilisateur choisit-il un fournisseur par défaut global, par album, ou à chaque lecture ?**
12. **Le basculement vers un autre fournisseur doit-il être automatique lorsqu’un média devient indisponible ?**
13. **Une playlist peut-elle mélanger YouTube et Spotify, sachant que l’autoplay inter-fournisseurs est limité et que les politiques des plateformes doivent être respectées ?**

### 25.5 Produit et exploitation

14. **Quel modèle économique est envisagé ?** Gratuit, don, abonnement ou autre. Cette décision influence les accords fournisseurs, les coûts et les mentions légales.
15. **Quelle structure juridique porte les demandes de quota et partenariats ?**
16. **Quel niveau de modération est requis à l’échelle ?** Validation communautaire seule, équipe d’administration, signalement, procédure de retrait par ayants droit.
17. **La PWA reste-t-elle la cible unique ou une application mobile native devient-elle nécessaire pour arrière-plan, écran verrouillé et intégrations système ?**

### Recommandation v1

La trajectoire la moins risquée est :

1. conserver le domaine indépendant des fournisseurs dès la v0 ;
2. mesurer le taux réel de résolution YouTube, Discogs videos et Spotify manuel ;
3. introduire d’abord une file interne multi-fournisseur explicite ;
4. n’ajouter OAuth Spotify ou un autre catalogue qu’après validation de l’accès public et des conditions ;
5. reporter la mutualisation entre éditions jusqu’à disposer d’un corpus de corrections permettant de mesurer les faux positifs.

---

## 26. Décisions opérationnelles encore nécessaires pour la production v0

Ce ne sont pas des questions produit bloquant le développement local :

- nom public définitif et identité visuelle ;
- domaine et URLs de callback ;
- compte Discogs développeur et credentials ;
- projet Google Cloud et clé YouTube ;
- identifiants Discogs des administrateurs initiaux ;
- hébergeur de l’application et de PostgreSQL ;
- adresse de support et procédure de signalement ;
- politique de confidentialité et conditions d’utilisation validées ;
- politique de sauvegarde, rétention et restauration ;
- décision de lancement bêta et nombre maximal d’utilisateurs.

---

## 27. Critères d’acceptation globaux de la v0

La v0 est livrable lorsque :

1. plusieurs utilisateurs peuvent se connecter avec Discogs et ne voient que leur collection ;
2. un import interrompu reprend sans corruption ni suppression prématurée ;
3. la collection est utilisable localement après import, avec recherche et filtres ;
4. les doublons physiques n’augmentent pas la probabilité aléatoire ;
5. le mode aléatoire ne répète pas un album dans une session ;
6. aucune recherche média n’est lancée avant une sélection explicite ;
7. YouTube utilise d’abord les correspondances et vidéos déjà connues ;
8. le quota YouTube est visible, global, configurable et ne bloque que les nouvelles recherches ;
9. une URL YouTube manuelle peut être validée et lue ;
10. une URL d’album Spotify peut être validée et lue dans un Embed ;
11. une correction est immédiatement active pour son auteur puis devient globale après confirmation indépendante ;
12. un administrateur peut annuler une correspondance abusive ;
13. les quatre familles d’événements privés sont enregistrées de manière idempotente ;
14. la suppression de compte efface les données privées et anonymise les contributions globales ;
15. les tests unitaires, intégration, E2E, accessibilité, typecheck et build passent ;
16. aucun secret n’apparaît côté client ou dans les logs ;
17. l’interface est pleinement utilisable sur petit mobile et tablette ;
18. la documentation permet à une nouvelle personne ou à un nouveau LLM de démarrer localement sans connaissance orale du projet.

---

## 28. Références externes à revérifier avant chaque intégration

Les politiques et quotas changent. Le développeur doit relire les sources officielles avant mise en production.

### Discogs

- Documentation développeur : https://www.discogs.com/developers
- Authentification : https://www.discogs.com/developers#page:authentication
- Collection utilisateur : https://www.discogs.com/developers#page:user-collection
- Release et champ `videos` : https://www.discogs.com/developers#page:database,header:database-release

### YouTube

- Démarrage et quotas : https://developers.google.com/youtube/v3/getting-started
- Coûts et réinitialisation : https://developers.google.com/youtube/v3/determine_quota_cost
- Recherche : https://developers.google.com/youtube/v3/docs/search/list
- Audit et extension : https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- IFrame Player : https://developers.google.com/youtube/iframe_api_reference

### Spotify

- Embeds : https://developer.spotify.com/documentation/embeds
- Création d’un Embed : https://developer.spotify.com/documentation/embeds/tutorials/creating-an-embed
- API iFrame : https://developer.spotify.com/documentation/embeds/references/iframe-api
- oEmbed : https://developer.spotify.com/documentation/embeds/reference/oembed
- Dépannage : https://developer.spotify.com/documentation/embeds/tutorials/troubleshooting
- Règles développeur : https://developer.spotify.com/policy
- Conditions développeur : https://developer.spotify.com/terms
- Règles de présentation : https://developer.spotify.com/documentation/design

---

## 29. Journal des décisions consolidées

| Décision                                                                    | Statut  |
| --------------------------------------------------------------------------- | ------- |
| architecture multi-utilisateur dès le départ                                | validée |
| identité par OAuth Discogs                                                  | validée |
| jeton personnel uniquement pour le développement                            | validée |
| correction immédiate pour l’auteur, globale après confirmation indépendante | validée |
| portée YouTube `édition + position de piste`                                | validée |
| correspondance Spotify d’album possible au niveau édition                   | validée |
| conservation anonymisée des corrections après suppression du compte         | validée |
| événements privés préparant la v2                                           | validée |
| français initial et architecture i18n                                       | validée |
| TypeScript, Next.js, PostgreSQL, Docker Compose                             | validée |
| monolithe modulaire, tâches en base, sans Redis                             | validée |
| Web/PWA mobile-first et tablette responsive                                 | validée |
| application centralisée uniquement en v0                                    | validée |
| random par éditions uniques, sans répétition de session                     | validée |
| résolution seulement après choix album/piste                                | validée |
| quota YouTube global clairement affiché                                     | validée |
| recherche YouTube manuelle et collage d’URL comme repli                     | validée |
| pas de scraping Google ou YouTube                                           | validée |
| Spotify via recherche manuelle, URL validée et Embed                        | validée |
| album Spotify privilégié pour l’enchaînement                                | validée |
| Deezer, Qobuz et Apple Music exclus de la v0                                | validée |
| mode découverte repoussé en v2                                              | validée |
