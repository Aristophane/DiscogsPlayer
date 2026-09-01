# Module `resolution`

Orchestration des fournisseurs, ordre strict des sources (§13.1, §14.2).

Règle d'isolation (CLAUDE.md) : ce module ne lit ni n'écrit les tables d'un autre
module ; il passe par le service exposé par celui-ci.
