# ADR-0015 — Parcourir la collection dans des bacs en perspective

Date : 18 septembre 2026. Statut : accepté, demande produit explicite.

## Décision

La route authentifiée `/bacs`, accessible depuis le header, présente la collection active
dans des bacs en trois dimensions. Elle réutilise les pochettes et les fiches `/sorties/`
existantes. Le sélecteur global permet de parcourir également une collection partagée,
après validation du partage côté serveur.

Trois regroupements sont proposés, par genre par défaut, puis année ou continent. Une
édition apparaît une fois, indépendamment du nombre d'exemplaires. Son premier genre
Discogs non vide détermine son bac. Les années d'édition sont décroissantes. Le continent
est celui du pays de l'édition selon UN M49, pas celui de l'artiste. Les territoires de
plusieurs continents sont rangés dans « International » ; les métadonnées absentes ou
inconnues restent accessibles dans un bac explicite en fin de liste. Aucun format de
la collection n'est exclu par cette présentation.

La molette et les glissements verticaux ou horizontaux font défiler les pochettes, puis
passent au bac suivant. Les sélecteurs, les flèches, un curseur et le clavier permettent
aussi de parcourir les disques. Le clic soulève et agrandit la pochette pendant 650 ms
avant d'ouvrir la fiche. Avec `prefers-reduced-motion`, la navigation est immédiate.

La scène utilise les transformations CSS 3D, sans moteur WebGL ni nouvelle dépendance.
Seules les pochettes voisines sont montées (dix au maximum) ; seules les transformations
sont animées. Le service charge les métadonnées compactes de toutes les éditions actives
de la collection pour permettre les regroupements et le parcours continu sans requête
réseau à chaque geste. Les images conservent le proxy Discogs et le repli existants.

## Conséquences

Le menu compact s'étend jusqu'à 1280 px pour laisser le sélecteur de collection à côté
du logo avec ce lien supplémentaire. Les contrôles restent utilisables au clavier et
sur petit écran. La molette retrouve le défilement de la page aux extrémités du parcours.

Aucune migration n'est nécessaire : pays, genres, année et pochettes sont déjà stockés.
Le volume des métadonnées initiales reste proportionnel à la collection, alors que le
nombre de pochettes rendues est borné ; une pagination des métadonnées pourra être
introduite si les collections les plus volumineuses le nécessitent.
