# ADR-0004 — File de tâches PostgreSQL et cadence des appels Discogs

- Date : 2026-09-02
- Statut : accepté
- Concerne : `SPECIFICATION.md` §9.4, §12.2, §12.3, SYNC-007, SYNC-008

## Contexte

Le Lot 2 introduit l'import de collections. Trois questions n'étaient pas tranchées par la
spécification : où prendre l'heure de référence des tâches, comment garantir la
déduplication globale, et comment respecter les limites Discogs autrement qu'en encaissant
des `429`.

Le premier import réel (351 albums, collection de test) a fourni la réponse à la troisième :
avec quatre tâches en parallèle et aucune cadence, **295 des 351 chargements de détail ont
été refusés en rafale**. Le backoff les rattrapait, mais l'import devenait long et bruyant,
alors que §12.3 demande justement de « s'arrêter temporairement avant d'atteindre zéro ».

## Décisions

**1. L'horloge de référence est celle de PostgreSQL.** `run_after` est écrit par la base ;
la réclamation compare donc avec `now()` côté SQL, pas avec un `Date` du processus. Une
dérive de quelques millisecondes entre le worker et la base rendait invisible une tâche
fraîchement insérée — symptôme observé en test avant correction.

**2. Déduplication par index unique partiel.** `tasks.dedupe_key` est unique parmi les
statuts vivants (`queued`, `running`, `retry_wait`). Deux collections contenant la même
édition ne produisent qu'une tâche `release:<id>` (§12.2), et la garantie est portée par la
base, donc valable même entre deux processus concurrents. Une tâche terminée libère la clé.

**3. Réclamation filtrable par type.** `claim()` accepte une liste de types : c'est ce qui
permettra de dédier un worker à un fournisseur et de borner la concurrence par fournisseur
(§9.4). Sans ce filtre, un worker mélange les files et la limite d'un fournisseur devient
inapplicable.

**4. Régulateur de débit (`pacer.ts`), en plus du backoff.** Le backoff réagit après
l'échec ; le régulateur l'évite. Il sérialise les appels Discogs d'un processus et déduit
l'intervalle de l'en-tête `X-Discogs-Ratelimit` — 60 appels/minute annoncés donnent un
appel par seconde. Sous cinq appels restants, il marque une pause franche plutôt que de
dépenser le dernier crédit. Aucune constante de débit n'est codée en dur (SYNC-008) : sans
en-tête, la cadence prudente par défaut s'applique, car l'absence d'information n'est pas
une autorisation.

Mesure après mise en place : plus aucun `429` sur le même import.

**5. Désactivation strictement différée.** Les instances non revues ne sont désactivées
qu'après réception de **toutes** les pages sans erreur (SYNC-007). Le compteur
`pages_processed` n'avance qu'après écriture réussie d'une page, ce qui rend la reprise
exacte : une tâche relancée après un `429` repart de la page interrompue.

## Conséquences

- Un import de 350 éditions demande environ six minutes de chargement de détails, cadencé,
  sans erreur — plutôt qu'une rafale de refus suivie de reprises étalées.
- Le régulateur est propre au processus. Plusieurs workers simultanés dépasseraient la
  limite ; le jour où cela arrive, la cadence devra être partagée (table de fenêtre, comme
  `provider_quota_windows` pour YouTube). Ce n'est pas nécessaire en v0 : un seul worker.
- `PROVIDER_METADATA_MAX_AGE_DAYS` ne pilote plus la fraîcheur du catalogue Discogs, qui a
  sa propre constante (`DETAILS_FRESHNESS_DAYS`) : la rétention YouTube obéit à une
  politique externe (§13.7), la fraîcheur d'une fiche Discogs à un choix produit.

## Alternatives écartées

- **Se reposer sur le seul backoff** : fonctionne, mais transforme chaque import en série
  d'échecs, pollue le journal et retarde l'utilisateur sans raison.
- **Constante « 60 par minute »** : contraire à SYNC-008, et fausse dès que Discogs
  applique une limite différente au compte.
- **Sérialiser les tâches (concurrence 1)** : réglerait le débit mais brimerait aussi les
  tâches qui ne parlent pas à Discogs.
