# Module `sync`

Imports Discogs et tâches PostgreSQL (§12).

Règle d'isolation (CLAUDE.md) : ce module ne lit ni n'écrit les tables d'un autre
module ; il passe par le service exposé par celui-ci.
