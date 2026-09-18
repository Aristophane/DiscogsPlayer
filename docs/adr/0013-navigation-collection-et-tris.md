# Collection active dans l'en-tête et accueil centré sur les pochettes

Demande produit du 18 septembre 2026, complément aux ADR 0011 et 0012.

Le sélecteur de collection est rendu dans l'en-tête persistant sur tous les écrans
connectés, visible hors du menu mobile. Les données viennent de la session serveur
et des partages actifs. La bascule conserve l'écran, sauf sur une fiche disque où
elle ouvre la collection choisie pour éviter une fiche devenue inaccessible. Les
filtres et tirages locaux sont réinitialisés lors du changement de propriétaire.
Le lecteur demeure dans le layout commun.

L'accueil supprime les tuiles Collection, Aléatoire et Radio ainsi que le lien
Paramètres final : ces destinations restent dans la navigation. Les tops présentent
de grandes pochettes carrées et le fil est limité aux cinq derniers ajouts des amis.
La barre, le décompte et le message de fin disparaissent une fois les valeurs à jour.

La collection propose trois tris décroissants supplémentaires : `have_desc` pour
le nombre de membres possédant l'édition, `want_desc` pour les wantlists et
`value_desc` pour le prix minimum d'annonce en euros, lorsqu'il y a des annonces.
Cette valeur n'est pas une estimation de l'exemplaire personnel. Les absences sont
placées à la fin, les égalités départagées par identifiant. Le curseur numérique
préserve les centimes et l'agrégation reste par édition, indépendamment des copies.

Aucune nouvelle donnée stockée ni migration nécessaire.
