# Module `playback`

Lecteur, file interne, événements privés (§8.5, §8.7).

Règle d'isolation (CLAUDE.md) : ce module ne lit ni n'écrit les tables d'un autre
module ; il passe par le service exposé par celui-ci.
