# ADR 0019 — Synchronisation automatique des collections

## Constat

Le mode `scheduled` et sa limite de 24 heures existaient sans déclencheur. Les collections
partagées reflétaient donc le dernier import manuel du propriétaire.

## Décision

Le worker vérifie les comptes connectés au démarrage puis toutes les minutes, entre deux
lots de tâches. Chaque compte non supprimé disposant d'identifiants Discogs est éligible,
même sans session ouverte. La collection d'un ami est synchronisée sous l'identité de
son propriétaire ; tous ses bénéficiaires consultent ensuite ces mêmes données.

Une synchronisation automatique attend 24 heures après la dernière synchronisation
terminée et après la dernière tentative automatique, y compris en échec définitif.
Les erreurs transitoires conservent les reprises et le backoff du worker. Le bouton
manuel reste disponible pendant ce délai, sans créer de seconde synchronisation active.

Un verrou transactionnel par compte sérialise les demandes concurrentes entre workers
et les demandes manuelles. Le run et sa tâche sont créés dans la même transaction.
Un compte en erreur ne bloque pas la planification des autres.

## Exploitation

Déployer et redémarrer le worker avec ce code. Aucun nouveau service, cron externe,
paramètre ou changement de schéma n'est nécessaire. Sans worker actif, les imports
restent en attente. La cadence effective dépend de la file et des limites Discogs.
Les identifiants OAuth invalides exigent toujours une reconnexion du propriétaire.

Le rafraîchissement d'une page affiche les données importées ; l'ajout de notifications
ou d'un rafraîchissement automatique de l'interface ne fait pas partie de ce changement.
