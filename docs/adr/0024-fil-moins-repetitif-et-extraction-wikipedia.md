# ADR 0024 — Récits prioritaires et extraction Wikipédia réaliste

Le 20 octobre 2026, l’extrait de l’accueil fourni par l’utilisateur montre une majorité
de suggestions génériques et de prix répétés. Deux récits anglais arrivent tard, dont
un hommage par des noms de rues. Les tests synthétiques de l’ADR 0023 ne suffisaient pas.

## Diagnostic et sélection

TextExtracts sépare ses paragraphes avec un seul saut de ligne. L’ancien parseur fusionnait
des sections entières ; une réserve bibliographique ou un détail sensible pouvait alors
écarter tous les récits d’une section. Le parseur respecte ces paragraphes. Les exclusions
portent sur les phrases concernées et une réserve isolée qualifie aussi la phrase précédente.
Les fenêtres restent bornées à 680 caractères, jusqu’à cinq phrases pour garder le contexte.
Une abréviation de titre comme « Sgt. » n’est pas une fin d’extrait acceptable.

Le seuil reste 26. La version éditoriale 2 reconnaît les techniques concrètes (une prise,
une journée, instruments de fortune), les adaptations identifiées et certaines origines
de compositions. Les influences vagues, prix, décès et noms de rues ne servent pas de
remplissage. La source, la langue et la licence restent visibles ; aucun fait n’est inventé.
La vérification manuelle de vrais articles français retrouve notamment l’enregistrement
d’Another Side of Bob Dylan, l’adaptation L’Été de Lavilliers, Pet Sounds et Sgt. Pepper,
ainsi qu’un emprunt de la musique de Lil’Darlin’ par Henri Salvador.

## Recherche, cache et reprise

La résolution exacte Discogs → Wikidata est conservée. La recherche passe de six sujets
album/artiste intercalés à douze artistes distincts, puis quatre albums. Deux sujets sont
traités simultanément ; aucune nouvelle paire ne démarre après 75 secondes. Un appel reste
borné par les délais HTTP existants. Les clés publiques deviennent `wiki:v3:kind:id` ; un
résultat vide expire après un jour, un résultat positif après trente jours.

Une panne partielle peut être retentée après quinze minutes, avec trois passages maximum
par édition. La migration additive 0016 ajoute `enrichment_attempts` et `retry_at`.
Une édition ancienne du jour repasse en attente à la prochaine visite ou planification.
L’historique ne déclenche pas de récupération externe. Les visites répétées conservent
la déduplication des tâches et leur backoff. Le navigateur surveille la préparation pendant
deux minutes et indique explicitement l’absence de nouveau récit si la recherche aboutit
sans passage satisfaisant.

## Présentation et répétitions

Dans chaque journée : anecdotes, presse, ajouts d’amis, suggestion, prix. Les positions
stockées et identifiants restent immuables. Le curseur inclut désormais le rang ; un ancien
curseur retrouve celui de sa publication d’ancrage. Les nouveaux récits restent annoncés
par un bouton avant de modifier une lecture en cours.

Au plus deux ajouts d’artistes différents et une suggestion par journée ; un artiste déjà
suggéré n’est pas repris pendant quatorze jours. Les prix reviennent au plus une fois par
semaine. La presse est limitée à une publication par artiste par jour, français prioritaire.
Ces plafonds filtrent aussi les anciennes éditions à la lecture, sans supprimer leurs cartes.
Le HTML RSS est décodé avant retrait des balises, y compris pour les anciennes cartes de presse.

## Déploiement et retour arrière

Redéployer web et worker ensemble après migration 0016. Le déploiement Compose habituel
applique la migration avant leur démarrage. Les colonnes additives peuvent rester en place
en cas de retour au code précédent. Aucun compte, collection ou historique n’est supprimé.

Vérification automatisée exclusivement sur fournisseurs simulés : régression TextExtracts,
cas de l’extrait utilisateur, couverture au-delà des premiers artistes, déduplication, reprise,
pagination par rang et anciens curseurs, autorisations, affichage et reprise de lecture.
Les lectures réseau manuelles de diagnostic sont séparées des tests.
