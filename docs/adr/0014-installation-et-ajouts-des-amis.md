# ADR-0014 — Installation et accès aux ajouts des amis

Date : 18 septembre 2026. Statut : accepté, demande produit explicite.

## Décision

Le sélecteur de collection reste sur la même ligne que le logo, y compris sur mobile,
en dehors du menu burger. Le menu devient compact sous 1024 px afin de préserver
l'espace du sélecteur et la lisibilité des liens.

Le fil des amis affiche les six dernières éditions ajoutées, au lieu des cinq prévues
par ADR-0013. Les pochettes occupent deux colonnes sur mobile et trois sur grand écran.
Chaque entrée propose « Voir plus » : la collection de l'ami devient active après
vérification du partage côté serveur, puis la page collection existante s'ouvre avec
`sort=date_added_desc`. Le tri initial est lu dans l'URL et validé par `parseSort` ; les
ajouts récents apparaissent en premier, selon l'agrégation existante `MIN(date_added)`.

Les paramètres proposent l'installation de Dig. Un contexte racine conserve l'événement
`beforeinstallprompt` entre les navigations ; le bouton consomme cette invitation une
seule fois. Sans invitation native, il indique les étapes adaptées à iOS, Safari macOS
ou aux autres navigateurs. Une origine HTTPS est nécessaire hors localhost.

Le manifeste déclare un démarrage à l'accueil en mode autonome, les icônes PNG 192 et
512 px, et une icône maskable. L'icône Apple 180 px est déclarée dans les métadonnées.
Toutes dérivent du logo Dig existant, sur fond opaque. Aucune dépendance ajoutée ni
évolution du schéma de données n'est nécessaire.

## Limites

L'installation et l'affichage de l'invitation dépendent du navigateur et de l'appareil.
Les instructions manuelles restent disponibles si aucune invitation n'est émise.
L'application reste connectée : aucun service worker ni cache hors ligne des données
personnelles n'est ajouté. Le manifeste et les icônes sont publics, les routes privées
conservent leur authentification.
