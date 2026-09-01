# Module `providers/youtube`

Recherche, validation, quota en unités, IFrame Player (§13, ADR-0002).

Règle d'isolation (CLAUDE.md) : ce module ne lit ni n'écrit les tables d'un autre
module ; il passe par le service exposé par celui-ci.
