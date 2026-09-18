# 0017 — Classer les bacs par origine des artistes

Date : 2026-09-18. Statut : accepté, demande explicite de l’utilisateur.

Cette décision remplace le classement géographique par marché de l’édition de
l’ADR 0015. Le champ Discogs `release.country` reste intact et ne sert plus à
choisir un continent.

## Source et règle de classement

Les artistes sont identifiés dans Wikidata uniquement par leur identifiant Discogs
exact ([P1953](https://www.wikidata.org/wiki/Property:P1953)). Aucun rapprochement
par nom, interprétation de biographie, nationalité ou déduction à partir d’un
pressage n’est effectué. Plusieurs entités pour le même identifiant restent un
résultat inconnu.

Les pays proviennent, par priorité, du pays d’origine explicite
([P495](https://www.wikidata.org/wiki/Property:P495)), du lieu de formation du groupe
([P740](https://www.wikidata.org/wiki/Property:P740), pays P17), puis du lieu de
naissance ([P19](https://www.wikidata.org/wiki/Property:P19), pays P17). Cette règle
documentaire est affichée dans l’interface : elle ne prétend pas définir toutes les
influences culturelles d’un artiste. Seuls des pays identifiés avec un code ISO
P297 et un nom sont retenus. Les territoires non reconnus restent inconnus.

Toutes les origines des artistes principaux crédités doivent être connues. Des pays
sur le même continent donnent un seul bac, plusieurs continents donnent « Plusieurs
continents ». L’absence d’artiste, une origine manquante ou un artiste générique
(Various, Unknown Artist…) donnent « Origine inconnue ». Les compilations Various
ne sont pas déduites de leur label ou de leur pays de vente.

## Enrichissement et stockage

La migration additive `0011_artist_origins` ajoute les pays d’origine, la source,
la date de consultation et la prochaine consultation à `discogs_artists`. Le cache
est partagé par les éditions et tous les utilisateurs. Les imports Discogs ne
remplacent pas ces champs.

L’ouverture de `/bacs` enfile les artistes manquants ou périmés de la collection
active validée par la session. La tâche `catalog.fetch_artist_origin` utilise le
worker existant, avec déduplication par artiste et priorité de fond. Les réponses
positives et négatives sont conservées 30 jours. Les pannes conservent les résultats
précédents, utilisent les reprises de la file et retardent d’au moins une heure un
nouvel enfilement. Une requête à la fois par processus, espacée d’au moins une
seconde, timeout de 20 secondes, User-Agent et respect de Retry-After. Voir les
[règles du service](https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual).

L’interface indique la couverture et propose « Actualiser les bacs ». Le regroupement
est recalculé après enrichissement sans import supplémentaire. Il n’y a pas de
réorganisation automatique pendant un geste. Chaque origine connue affiche un
lien vers sa source. Aucun appel au fournisseur réel en mode fixtures.

## Mise en service et retour arrière

Exécuter `npm run db:migrate` sur la base de l’application avant de déployer ce code,
puis redémarrer le worker. Aucune clé Wikidata supplémentaire n’est nécessaire.
Configurer un `DISCOGS_USER_AGENT` identifiant l’application et son contact : cet
agent est aussi envoyé à Wikidata. Les premiers bacs peuvent être inconnus pendant
le traitement de fond. Une origine non documentée reste inconnue après traitement.

Retour arrière : redéployer la version précédente ; les colonnes additives peuvent
rester en place sans effet. Si leur suppression est nécessaire, arrêter les nouveaux
workers et retirer les tâches `catalog.fetch_artist_origin` avant de supprimer les
quatre colonnes `origin_*` ajoutées à `discogs_artists` (les données d’enrichissement
seraient perdues, les données Discogs restent intactes).
