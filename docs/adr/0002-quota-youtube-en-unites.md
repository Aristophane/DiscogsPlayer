# ADR-0002 — Compter le quota YouTube en unités, pas en appels

- Date : 2026-09-02
- Statut : accepté
- Corrige : `SPECIFICATION.md` §13.3 (voir `docs/SPEC-GAPS.md` G-01)

## Contexte

La spécification décrit deux compartiments de quota YouTube : « 100 appels `search.list`
par jour » et « 10 000 unités pour les autres endpoints ». Le modèle réel de la YouTube
Data API v3 est un compartiment **unique** de 10 000 unités par jour et par projet, dans
lequel `search.list` coûte 100 unités et `videos.list` 1 unité. La limite « 100 recherches »
est donc dérivée, pas indépendante, et les validations `videos.list` (§13.5) puisent dans
le même budget que les recherches.

Implémenter le modèle décrit conduirait à deux défauts : un compteur de recherches faux
dès que des validations ont lieu, et une famine des validations en fin de journée.

## Décision

`provider_quota_windows` compte des **unités** pour l'opération logique `youtube.units`,
sur une fenêtre journalière calée sur minuit `America/Los_Angeles`.

- Chaque opération déclare son coût (`YOUTUBE_SEARCH_UNIT_COST`,
  `YOUTUBE_VIDEOS_UNIT_COST`), configurable et non codé en dur (exigence §13.3 conservée).
- Une réserve (`YOUTUBE_SEARCH_RESERVE_UNITS`, 1000 par défaut) est inaccessible aux
  recherches : les validations et l'affichage restent possibles quand les recherches sont
  coupées.
- Réservation atomique avant appel (`UPDATE ... WHERE estimated_used + cost <= limit
RETURNING`), sans remboursement sur erreur applicative, remboursement uniquement si la
  requête n'a pas été émise (G-16).
- Une réponse `quotaExceeded` de Google écrase l'estimation et positionne `exhausted_at`.
- L'UI affiche « recherches restantes estimées » =
  `floor((limite − utilisé − réserve) / coût_recherche)`, en signalant qu'il s'agit d'une
  estimation globale à l'application (§13.3).

## Conséquences

- Le critère d'acceptation v0 n°8 reste satisfait : quota visible, global, configurable,
  ne bloquant que les nouvelles recherches.
- Si Google modifie les coûts, seule la configuration change.
- `SPECIFICATION.md` §13.3 doit être réécrit lors de la prochaine révision du document.

## Alternatives écartées

- **Garder deux compteurs** : mathématiquement faux, invérifiable en test.
- **Compter uniquement les recherches** : ignore le coût des validations et provoque des
  échecs `quotaExceeded` non anticipés.
