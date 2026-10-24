# 0026 — Notes Discogs et retour dans l’historique radio

Date : 2026-10-24

## Contexte

La moyenne des notes attribuées par la communauté Discogs doit apparaître sur les
fiches albums, dans deux classements et parmi les publications du fil. La radio doit
permettre de revenir aux titres précédents.

## Décision

- La note vient de `community.rating.average` et son nombre de votes de
  `community.rating.count` dans la réponse release Discogs. Elle concerne l’édition
  présente dans la collection, sur cinq ; ce n’est pas une note personnelle.
- Trois colonnes additives conservent la moyenne, le nombre de votes et leur date de
  récupération. Ce dernier champ permet de rafraîchir les anciens imports même si
  leurs prix et compteurs viennent d’être mis à jour. Une absence récemment vérifiée
  reste fraîche pendant 24 heures, pour éviter les boucles de requêtes.
- La fiche distingue l’absence de vote d’une note encore indisponible. Les statistiques
  affichent cinq éditions actives distinctes dans chaque sens. Les éditions sans vote
  ou moyenne sont exclues ; le nombre de votes puis le titre départagent les ex æquo.
  Le sélecteur de collection et les contrôles de partage continuent de définir le
  propriétaire des résultats.
- Les publications statistiques du fil peuvent présenter une note et son nombre de
  votes. Elles alternent avec les prix quand les deux sont disponibles, en conservant
  la fréquence existante d’une publication statistique au plus tous les sept jours.
  Les anciens instantanés sans note restent lisibles.
- Le lecteur garde les réponses résolues de la radio et un curseur dans cette liste.
  « Piste précédente » rejoue un titre déjà servi. « Piste suivante » reparcourt les
  titres connus, puis reprend les tirages. Cela ne consomme pas de recherche YouTube
  ni de nouveau tirage pour les titres déjà présents dans l’historique.
- L’historique survit aux navigations et à la fin de la radio, tant que le lecteur
  reste ouvert. Une nouvelle radio, un album, une piste explicitement choisie ou une
  fermeture l’effacent. Les commandes d’historique sont désactivées pendant un tirage.

## Migration et retour arrière

La migration `0018_spotty_night_thrasher.sql` ajoute uniquement les trois colonnes de
note. Les versions antérieures peuvent les ignorer. Après retour à une ancienne
version, ces colonnes peuvent être retirées indépendamment des autres statistiques.

## Validation

Les tests vérifient la validation des réponses Discogs, l’import et le rafraîchissement
sans changement des pistes, les classements et leurs exclusions, les publications du
fil et la compatibilité des anciens contenus. Les tests du lecteur vérifient le retour,
la reprise de l’historique sans requête et son effacement. Les parcours navigateur
couvrent les fiches, les classements et les commandes radio sur plusieurs écrans.
