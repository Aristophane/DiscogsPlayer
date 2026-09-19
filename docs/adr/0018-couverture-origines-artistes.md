# ADR 0018 — Couverture et suivi des origines d’artistes

## Constat

Le seul lien Discogs → Wikidata ne couvre pas tous les artistes. Les absences étaient
conservées trente jours et l’interface ne distinguait pas un artiste non traité d’une
recherche terminée sans résultat. Les contrôles directs de Bernard Lavilliers et Bob Dylan
retrouvent pourtant leurs origines : une faible couverture peut aussi révéler un worker
en retard ou non mis à jour, et ne prouve pas l’absence de données.

## Décision

1. Conserver Wikidata (origine explicite, formation, naissance) comme première source.
2. À défaut, lire la fiche Discogs par identifiant avec le transport authentifié et régulé
   existant. Accepter uniquement une introduction explicitant le pays de l’artiste,
   une description nationale suivie immédiatement d’un métier musical, ou une première
   clause de naissance/formation avec pays explicite. Ni villes seules, ni influences,
   ni pays de label, ni pays d’édition ne permettent de déduire une origine.
3. À défaut, retrouver une identité MusicBrainz unique via l’URL Discogs exacte, puis
   interroger Wikidata par cet identifiant MusicBrainz. Le pays associé MusicBrainz
   n’est pas utilisé : il ne garantit pas le pays de naissance ou de formation.
4. Une panne n’est jamais enregistrée comme un résultat vide. Essayer les autres sources
   avant de conserver une erreur et le délai de reprise durable.
5. Versionner les recherches. Retenter les anciennes absences dès la prochaine visite
   des bacs ; conserver ensuite les absences un jour, les résultats positifs trente jours.
   Conserver les résultats précédents pendant les pannes et respecter le backoff.
6. Afficher les comptes d’artistes identifiés, en attente, sans origine trouvée et en
   erreur ; actualiser ce suivi toutes les cinq secondes. Les données sont résolues
   depuis le propriétaire de collection de la session, jamais un identifiant client.
   Le bouton d’actualisation applique les nouveaux groupes sans interrompre une
   manipulation des pochettes. Signaler explicitement un worker incompatible.

Le cache reste partagé entre collections. Aucune correspondance n’est codée pour les
trois artistes fournis comme exemples ; leurs descriptions servent de régressions.

## Exploitation et limites

Appliquer la migration 0012 et déployer/redémarrer **web et worker** ensemble.
La prochaine visite `/bacs` enfile les recherches nécessaires. Le temps de traitement
dépend de la file d’import et des limites des fournisseurs. Sans worker actif les
artistes restent en attente ; sans données suffisantes ils restent inconnus.
Le parseur de biographies est volontairement limité : les biographies ambiguës passent
aux sources structurées. Pas de promesse de couverture universelle.

La migration ajoute une colonne sans modifier les données existantes. Retour arrière :
revenir au code précédent en conservant la colonne (suppression optionnelle ultérieure).

Références : https://musicbrainz.org/doc/MusicBrainz_API et
https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting.
