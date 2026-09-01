# ADR-0001 — Journal des décisions architecturales

- Date : 2026-09-02
- Statut : accepté

## Contexte

`SPECIFICATION.md` §24 impose un journal ADR et §1 impose de documenter toute hypothèse
prise en cas d'ambiguïté. Il faut un format stable, lisible par un humain comme par un LLM.

## Décision

Un fichier par décision dans `docs/adr/`, nommé `NNNN-titre-en-kebab-case.md`, avec les
sections : Contexte, Décision, Conséquences, Alternatives écartées, Statut
(`proposé` | `accepté` | `remplacé par ADR-XXXX`).

Une décision **produit** (périmètre, fournisseur, modèle de confidentialité) ne peut pas
être prise par ADR : elle exige une validation humaine et une mise à jour de
`SPECIFICATION.md` §29.

Les résolutions par défaut listées dans `docs/SPEC-GAPS.md` valent hypothèses documentées
au sens de §1.3 tant qu'elles ne sont pas contredites.

## Conséquences

- Toute divergence avec la spécification est traçable.
- Un nouvel intervenant lit `SPECIFICATION.md`, puis `docs/SPEC-GAPS.md`, puis les ADR.
