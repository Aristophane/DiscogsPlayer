# ADR-0005 — Recherche normalisée, tri linguistique et isolation des tests

- Date : 2026-09-02
- Statut : accepté
- Concerne : `SPECIFICATION.md` §7.3, §8.3, §17.3, §20.2, §22 ; SPEC-GAPS G-03, G-15, G-19

## Contexte

Le Lot 3 rend la collection utilisable. Quatre points n'étaient pas tranchés par la
spécification, et trois d'entre eux ont été révélés par des tests ou par les données
réelles, pas par la lecture du document.

## Décisions

**1. Colonnes normalisées pour la recherche et le tri.** `search_text`,
`title_normalized` et `artists_normalized` sont écrites à l'import. COLL-003 exige que la
casse et les accents n'empêchent pas une correspondance ; la comparaison à la volée
interdirait tout index. Deux découvertes ont façonné la normalisation :

- La décomposition Unicode NFD ne sépare pas `æ`, `œ`, `ø`, `ß` : ce sont des lettres, pas
  des lettres accentuées. Sans table de correspondance, « agaetis » ne trouvait pas
  « Ágætis Byrjun ». Une table explicite complète donc la décomposition.
- La base est en collation `en_US.utf8`, où `lower('Ágætis') > lower('Zoo')` : un tri par
  titre reléguait tous les titres accentués en fin de liste. Le tri porte donc sur les
  colonnes normalisées, jamais sur le texte d'origine.

**2. Pagination par curseur opaque.** Le curseur encode `(clé de tri, identifiant, tri)`.
L'identifiant est indispensable : sans lui, deux albums de même clé feraient boucler ou
sauter la pagination. Un curseur émis pour un autre tri, périmé ou tronqué ramène à la
première page plutôt que de produire une erreur. Les valeurs absentes sont placées en fin
d'ordre (`NULLS LAST`) et le curseur distingue explicitement cette zone.

**3. Proxy d'images plutôt que `next/image`.** Les images Discogs sont protégées contre le
hotlinking et l'origine exige un `User-Agent` : l'optimiseur de `next/image` ne peut pas
les atteindre. Une route serveur les relaie, avec allowlist d'origines, refus des
redirections, timeout, plafond de taille et vérification du type (§18.3). Les segments de
chemin ne sont pas ré-encodés — les URL Discogs contiennent `rs:fit`, que le
percent-encoding casserait — mais validés contre une liste de caractères sûrs.

**4. Contraste : tons pleins, pas d'opacité.** Un texte secondaire en
`text-foreground/60` se compose avec l'arrière-plan réel : sur les tuiles grises, le
contraste tombait à 3,25:1 contre les 4,5:1 exigés (§20.2). Un token `--muted` plein
remplace toutes les opacités. Vérifié par axe, sur trois tailles d'écran.

**5. Base de test dédiée et espaces de noms disjoints.** Deux incidents ont eu lieu sur la
base de développement :

- le worker local consommait les tâches créées par les tests, faussant deux d'entre eux ;
- un nettoyage `like '9920%'` a supprimé une **édition réelle** de la collection, les
  identifiants Discogs étant des nombres à sept chiffres.

Résolution : les tests d'intégration s'exécutent sur `discogs_player_test`, créée et migrée
par `npm run db:test:prepare`, lancé automatiquement avant `vitest`. Et un nettoyage de
test ne s'appuie jamais sur un motif qui pourrait désigner une donnée réelle : soit un
préfixe non numérique (`test-…`), soit une énumération exacte des identifiants.

## Conséquences

- Les tests peuvent nettoyer agressivement sans menacer les données de développement.
- Les tests de bout en bout, eux, visent la base servie par l'application : ils utilisent
  donc des identifiants préfixés et un compte dédié.
- Toute nouvelle colonne dérivée d'un texte devra être remplie par migration pour les
  lignes existantes, comme l'ont été `search_text` et les colonnes de tri.

## Alternatives écartées

- **`unaccent` de PostgreSQL** : l'extension n'est pas garantie chez un hébergeur, et la
  normalisation doit rester identique côté application pour le scoring du Lot 6.
- **Collation ICU par colonne** : correcte, mais déplace la règle dans le schéma et ne
  résout pas la recherche, qui a de toute façon besoin d'une colonne normalisée.
- **Pagination par `offset`** : saute ou duplique des éléments dès que la collection change
  entre deux pages.
