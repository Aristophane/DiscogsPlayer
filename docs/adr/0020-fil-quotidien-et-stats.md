# ADR 0020 — Fil quotidien et onglet Stats

## Choix produit

Demande du 17 octobre 2026 : un accueil personnel sous forme de fil vertical, avec
dépliage des textes et chargement progressif de l'historique. Il mêle ajouts des amis,
suggestions d'écoute, histoires de disques, portraits et presse musicale. Pas
d'anniversaires de sorties. La sélection repose sur la collection personnelle et les
collections partagées, indépendamment du sélecteur de collection active.

Les classements quittent l'accueil pour `/stats`, accessible dans la navigation.
Une carte de prix peut apparaître dans la sélection quotidienne. Les Stats suivent
la collection sélectionnée et restent consultables pour les amis autorisés.

Sources gratuites, français privilégié et anglais accepté, sans traduction ou
rédaction par IA payante. Les textes restent des extraits attribués aux éditeurs.

## Sélection et stockage

La migration additive `0013_home_feed` crée les éditions quotidiennes, leurs cartes
et un cache public de sources. Le jour est calculé dans le fuseau Europe/Paris.
Les suggestions sont déterministes par utilisateur et par jour ; les cartes sont
persistées. Les sources ajoutées ensuite prennent les positions suivantes : aucune
carte existante n'est déplacée. L'interface annonce les nouveaux récits et attend un
clic avant de remplacer la sélection déjà affichée.

Les nouveautés des amis sont datées par la première acquisition d'une édition,
comme la collection. Elles ne réapparaissent pas chaque jour ; les articles de presse
sont aussi dédupliqués par URL. La pagination utilise jour et position et ne fabrique
pas de nouvelles cartes lorsque l'historique est épuisé. Un bouton de chargement reste
disponible au clavier et sert de repli au défilement automatique.

Chaque lecture authentifiée recontrôle les partages et les éditions encore possédées,
y compris pour les anciennes journées. Un identifiant de propriétaire client ne permet
pas de choisir le fil d'un autre utilisateur. L'écoute et l'ouverture d'un disque d'ami
passent par la bascule de collection contrôlée existante.

## Sources externes

Le worker crée les sélections quotidiennes et traite les enrichissements après les
imports. Aucun appel aux sources n'est effectué pendant le rendu de la page. Le
parcours initial reste utilisable avec les ajouts et les suggestions locales.

- Wikipédia : identité Wikidata par identifiant Discogs d'artiste (`P1953`) ou de
  master (`P1954`), article français puis anglais. Plusieurs identités sont refusées.
  Un portrait utilise un extrait introductif ; l'histoire d'un album privilégie un
  paragraphe concernant enregistrement, production, composition ou pochette. Le lien
  conserve la révision et la licence est lue dans les métadonnées du wiki.
- Presse : flux RSS officiels Musiques du Monde et Music du Guardian. Les titres
  récents mentionnant le nom complet d'un artiste de la sélection sont retenus.
  Les noms très courts sont exclus pour limiter les homonymies. Ce rapprochement
  éditorial par titre n'est pas une identité structurée : une homonymie reste possible.
  Le texte est limité à 24 mots du flux ; l'article complet reste chez l'éditeur.

Le cache des articles Wikipédia dure trente jours, celui des flux six heures. Une
panne conserve les résultats disponibles et ne transforme pas une erreur en absence.
Un compte reçoit au maximum six recherches Wikipédia et quatre actualités par
édition quotidienne. Les requêtes ont un délai maximal, une taille bornée et des
origines fixes ; ni HTML distant ni entité XML externe ne sont exécutés.

La couverture dépend des identifiants présents dans les sources : tous les disques
n'ont pas d'article. Aucun événement, anniversaire ou fait biographique n'est inventé.

## Stats

Le repère monétaire additionne les minima d'annonces disponibles pour les exemplaires
possédés. Les éditions sans annonce sont exclues et la couverture est affichée. Ce
chiffre n'est ni une cote de vente, ni une estimation de revente ou d'assurance.
Les éditions « moins répandues » sont classées par nombre de collections Discogs
déclarant les posséder ; ce n'est pas un nombre de pressages.

## Déploiement et retour arrière

Appliquer les migrations et déployer web et worker ensemble. Redémarrer le worker
pour activer les sélections et enrichissements quotidiens. Aucune clé supplémentaire
n'est nécessaire. Le code précédent peut être redéployé en conservant les trois
tables inutilisées ; la suppression de ces tables reste optionnelle et destructive.

Les tests utilisent des fournisseurs simulés et une base PostgreSQL dédiée. Les
tests navigateur utilisent aussi cette base, refusent de réutiliser un serveur local
existant et démarrent Next avec Webpack pour contourner le problème Turbopack local.

Documentation :

- https://www.mediawiki.org/wiki/Extension:TextExtracts
- https://www.wikidata.org/wiki/Property:P1953
- https://www.wikidata.org/wiki/Property:P1954
- https://www.lemonde.fr/le-monde-et-vous/article/2025/07/14/les-flux-rss-du-monde-fr_5498778_3237.html
- https://www.theguardian.com/help/feeds
