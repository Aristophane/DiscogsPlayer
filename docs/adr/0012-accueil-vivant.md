# Accueil : progression, nouveautés des amis et suggestion

Demande produit du 18 septembre 2026.

Les classements personnels relisent une API authentifiée toutes les cinq secondes
pendant l'actualisation. La barre indique les éditions dont le relevé date de moins
de 24 heures, y compris les absences vérifiées. Les valeurs anciennes restent
visibles pendant leur renouvellement. Le décompte se suspend dans un onglet masqué,
les requêtes ne se chevauchent pas et cessent quand toutes les éditions sont à jour.
Une erreur de lecture conserve les résultats et autorise une nouvelle tentative.
Le worker et sa cadence Discogs restent responsables du chargement des valeurs.

Le fil présente les douze derniers ajouts connus des collections partagées avec
l'utilisateur connecté, indépendamment de la collection qu'il consulte. Les
partages révoqués et les exemplaires retirés sont exclus. Comme dans la collection,
une édition est dédupliquée par ami, avec la première date d'acquisition ; les dates
inconnues sont indiquées et placées en dernier. Il s'agit des données de la dernière
synchronisation de chaque ami, sans appel Discogs supplémentaire. Ouvrir un disque
bascule vers sa collection après revérification serveur du partage.

La suggestion est tirée uniformément parmi les éditions actives de la collection
consultée. Un nouveau chargement de l'accueil ou « Un autre disque » relance le tirage.
Le dernier identifiant est mémorisé par collection dans sessionStorage pour éviter
une répétition immédiate, sauf collection d'un seul disque. Sans stockage navigateur,
le tirage fonctionne mais cette mémoire ne survit pas au rechargement. Le polling
des classements ne change pas la suggestion et ne recharge pas le lecteur.

Aucun nouveau stockage serveur : les dates d'ajout, partages et dates de relevé
existants suffisent. Aucune migration de schéma nécessaire pour cette extension.
