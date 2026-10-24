# 0025 — Radio personnelle, radio avec les amis et recherches bornées

Date : 2026-10-24

## Contexte

Certaines recherches laissent la radio en attente sans enchaîner. La radio doit aussi
proposer deux périmètres : la collection personnelle et son mélange avec les collections
partagées par les amis.

## Décision

- Le lancement propose « Ma collection » (par défaut) et « Ma collection + amis ».
  La collection actuellement consultée dans le reste de l’application ne change pas
  ces deux périmètres. Le serveur détermine le propriétaire depuis l’utilisateur connecté.
- `radio_sessions.include_friends`, ajouté avec une valeur par défaut `false`, conserve
  ce choix pour tous les tirages de la session. Une seule session joue à la fois.
- Le mélange inclut uniquement les partages reçus et encore actifs. Les droits sont
  revérifiés au tirage et avant de servir le média ; les éditions communes ne créent
  pas de doublons. Les filtres et leur nombre d’éditions reflètent le périmètre choisi.
- Une résolution radio dispose de six secondes et le budget de recherche d’un tirage
  de douze secondes, dans la limite existante de six tentatives. Les médias locaux
  restent disponibles en repli après épuisement de ce budget. Une résolution arrivée
  tard peut alimenter le cache, mais ne remplace pas la piste choisie ensuite.
- Le lecteur borne ses requêtes à vingt secondes et retente une fois un tirage en
  erreur réseau. Si la connexion reste indisponible, il affiche la fin de radio avec
  une possibilité de relance. Une vidéo illisible ou qui ne démarre pas en quinze
  secondes déclenche le tirage suivant ; une pause explicite annule cette surveillance.
- Une fermeture ou une nouvelle demande de lecture invalide les réponses précédentes.

## Migration et retour arrière

La migration `0017_sweet_maggott.sql` ajoute seulement la colonne `include_friends`.
L’ancienne application peut fonctionner avec cette colonne supplémentaire. Pour retirer
ensuite le schéma, supprimer cette colonne après retour à l’ancienne version du code.

## Validation

Les tests couvrent les deux périmètres, les filtres, les doublons et révocations, les
recherches qui échouent ou restent suspendues, les erreurs du lecteur, le respect de
la pause et l’invalidation des réponses tardives.
