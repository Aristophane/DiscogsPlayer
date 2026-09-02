# ADR-0007 — Résolution média simplifiée (Lot 5 repoussé)

- Date : 2026-09-02
- Statut : accepté
- Concerne : `SPECIFICATION.md` §13, §14, §10.4 ; amende l'ordre de §13.1 et §14.2

## Contexte

Le Lot 5 (corrections communautaires — propositions, confirmations, promotion, vote) est
repoussé à la demande du porteur du produit, au profit d'une lecture fonctionnelle
immédiate. Sans ce lot, `mapping_proposals` et `mapping_confirmations` n'existent pas :
l'ordre de résolution complet de §13.1 (préférence utilisateur → proposition globale
confirmée → vidéo Discogs → recherche → repli manuel) ne peut pas être implémenté tel quel.

Portée demandée : lecture depuis les vidéos déjà présentes sur les fiches Discogs ; à
défaut, recherche YouTube automatique ; à défaut, recherche Spotify — uniquement si
l'utilisateur a indiqué posséder un compte Spotify à l'onboarding.

## Décisions

### 1. `track_resolutions` remplace `mapping_proposals`/`mapping_confirmations`

Une table minimale, une ligne par piste, sans vote ni conflit : la dernière résolution
automatique réussie fait foi. Ce n'est **pas** une version incomplète du modèle
communautaire — c'est un remplacement temporaire, à yer quand le Lot 5 sera repris, pas à
compléter en place. `provider_entities` (§10.4) est conservée telle quelle : c'est un cache
de métadonnées, indépendant du modèle de correction.

### 2. Ordre de résolution simplifié

1. `track_resolutions` (cache) ;
2. vidéo Discogs déjà connue, appariée par similarité de titre — gratuit, aucun appel ;
3. recherche YouTube automatique si le quota le permet (ADR-0002) ;
4. repli manuel : lien de recherche YouTube toujours proposé, lien de recherche Spotify
   **seulement** si `users.spotify_enabled = 'yes'`.

### 3. Appariement vidéo → piste par similarité de Jaccard, pas par position

Vérifié sur la collection réelle : le nombre de vidéos Discogs égale rarement le nombre de
pistes (échantillon de 80 éditions : 25 % des pistes appariées par titre, hors repli). Un
mappage par position aurait été faux la majorité du temps. La similarité se calcule sur les
mots communs rapportés à leur union (Jaccard), seuil 0,34 — calibré empiriquement, un titre
de vidéo « Artiste - Titre » ajoutant presque toujours 1 à 4 mots au titre de la piste.

Liste de signaux négatifs (§15.2) étendue en cours de développement : un premier test a
laissé passer une vidéo « Interview Backstage » via le repli à vidéo unique, faute
d'exclusion pour le contenu non musical. Ajout de `interview`, `documentary`, `trailer`,
`teaser`, `behind the scenes`, `making of`, `unboxing`. Cette liste est désormais partagée
entre l'appariement Discogs et l'acceptation des résultats de recherche YouTube — deux
listes distinctes avaient déjà divergé une fois pendant le développement (« live » manquant
dans l'une des deux), ce qui a fait échouer un test avant d'être corrigé.

### 4. Bouton play, pas de sélection de candidats

Le choix demandé est un bouton play direct : clic sur un album lit sa première piste
jouable, clic sur une piste la résout et la lit. Aucune liste de candidats affichée en v0
simplifiée (§13.1 « 3 à 5 candidats » n'est pas implémenté) : le premier résultat
acceptable est retenu automatiquement. La complexité de sélection manuelle est reportée
avec le reste du Lot 5.

### 5. En-tête de navigation, au-dessus de la barre basse existante

La spécification ne prévoit qu'une barre basse mobile (§7.2). Un en-tête haut la complète,
seul moyen d'atteindre la collection, l'aléatoire et les paramètres depuis un écran qui
n'a pas cette barre (fiche album, import). Sur petit mobile (390 px), le nom de
l'application et quatre liens ne tiennent pas sur une ligne : la navigation défile
horizontalement plutôt que de passer à la ligne, qui recouvrait le contenu suivant — défaut
réel observé en capture avant correction.

## Conséquences

- Le Lot 5, quand il sera repris, remplacera `track_resolutions` par le modèle complet —
  ce n'est pas une migration additive de cette table, mais un remplacement de mécanisme.
- Le mode Radio (lecture continue par genre) reste hors périmètre : il suppose une file
  multi-albums que ce lot ne construit pas, seulement l'enchaînement à l'intérieur d'un
  album (§13.6).
- Aucune clé YouTube n'était disponible pendant le développement : la recherche automatique
  échoue proprement (repli manuel) tant qu'elle n'est pas configurée. Vérifié en conditions
  réelles uniquement pour la résolution par vidéo Discogs, qui ne dépend d'aucune clé.

## Alternatives écartées

- **Construire le modèle `mapping_proposals` maintenant, sans le workflow de vote** :
  aurait demandé le même effort que le Lot 5 sans la fonctionnalité qui le justifie
  (correction communautaire), pour un bénéfice nul en v0 mono-résolution.
- **Mappage vidéo/piste par position** : contredit directement les données réelles.
