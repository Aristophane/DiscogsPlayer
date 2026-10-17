# Module `sync`

Imports Discogs et tâches PostgreSQL (§12).

Le worker planifie automatiquement les collections des comptes connectés au démarrage
puis vérifie chaque minute. Délai minimal : 24 heures après le dernier import terminé
ou la dernière tentative automatique. Les collections partagées utilisent l'import
de leur propriétaire, sans doublon par ami. La synchronisation manuelle reste disponible.
Voir ADR-0019 ; redémarrer le worker après déploiement pour activer la planification.

Règle d'isolation (CLAUDE.md) : ce module ne lit ni n'écrit les tables d'un autre
module ; il passe par le service exposé par celui-ci.
