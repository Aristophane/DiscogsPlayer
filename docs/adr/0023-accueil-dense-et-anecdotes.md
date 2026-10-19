# ADR 0023 — Accueil compact et histoires sélectionnées

Demande du 19 octobre 2026 : voir deux à trois publications par écran et découvrir des
histoires plus intéressantes sur les disques et les artistes de la collection.

## Présentation

Le fil conserve sa lecture verticale et ses identifiants. Chaque publication devient
une ligne éditoriale avec pochette à gauche (104 px sur téléphone, 160 px dès 640 px),
titre, contexte et aperçu de trois lignes. Les actions, la source et la licence restent
accessibles. Le dépliage conserve la position de lecture et révèle le texte complet.
L’accueil connecté s’élargit à 896 px. Les tests navigateur vérifient deux publications
entières et le début d’une troisième sur les écrans de référence.

Cette présentation remplace le grand carré centré de l’ADR 0021 ; le mécanisme de
reprise de lecture, les autorisations et le chargement progressif sont conservés.

## Sélection des histoires

La résolution Discogs → Wikidata → Wikipédia reste exacte, en français puis en anglais.
L’adaptateur existant demande les titres de sections au format wiki : aucune requête
supplémentaire par section. L’extracteur parcourt jusqu’à 200 000 caractères d’un article.
Il conserve des fenêtres d’une à trois phrases complètes de 110 à 680 caractères.

Le score éditorial est déterministe et explicable : incidents ou choix inattendus,
origine d’un nom, histoire de pochette, expérimentations d’enregistrement et premières
techniques. Les bios introductives, chronologies, crédits, classements, notes et références
sont écartés ou pénalisés. Les fragments dépendant d’un antécédent sont évités. Les mentions
d’incertitude, les crises personnelles et les paroles citées sont écartées de cette rubrique
légère. Un seuil de 26 empêche un résumé biographique ordinaire de servir de remplissage.
Le score reste interne ; ce n’est ni un indicateur de vérité ni une mesure de l’humour.

Le texte affiché garde les phrases de la source. Aucune citation, chute ou aventure n’est
créée. Le titre de l’article identifie le sujet et une rubrique indique le thème. La
source conserve sa révision et sa licence. Sans passage suffisant, les autres publications
locales et les actualités continuent à alimenter le fil.

Chaque article met jusqu’à trois passages diversifiés en cache. Une édition reçoit au
plus quatre anecdotes, au plus une par sujet, choisies parmi les passages encore inédits
pour ce compte. Les anecdotes suivantes peuvent être proposées un autre jour sans nouvel
appel fournisseur. La déduplication normalise l’identité de l’article et le texte ; une
révision `oldid` ou une référence numérique seule ne republie pas le même fait.
Les limites sont revérifiées sous le verrou transactionnel existant, y compris en reprise.

## Cache et reprise

Les clés Wikipédia passent à `wiki:v2:kind:id`. Les anciens extraits génériques ne bloquent
pas la nouvelle recherche pendant trente jours. La migration additive 0014 ajoute
`feed_editions.editorial_version`, initialement zéro. La sélection actuelle est version 1.
La prochaine ouverture ou planification quotidienne remet seulement l’édition du jour
ancienne en attente. Le worker ajoute les nouveaux récits sans déplacer les publications.

Les anciens récits Wikipédia sont filtrés à la lecture avec le même critère ; les passages
intéressants conservent leurs identifiants et sont comparés aux nouvelles empreintes pour
éviter leur duplication. Les biographies ordinaires cessent d’encombrer le fil. Les
anciennes éditions ne déclenchent aucune récupération réseau. Les sources et le cache
public restent partagés, les sélections et les contrôles de visibilité restent personnels.

## Adéquation de l’infrastructure

Node, PostgreSQL et le worker existants suffisent à cette sélection. Le travail de texte
est borné et effectué en arrière-plan ; aucune requête Wikipédia ne bloque le rendu.
Les plafonds actuels (six sujets et quatre actualités par édition) sont conservés.
Cette version n’ajoute aucun abonnement, clé, modèle ni service d’inférence.

Une rédaction humoristique générative pourrait être ajoutée comme étape du même worker,
avec cache par sujet, langue, révision et version de rédaction. Elle demanderait un
fournisseur de modèle ou un serveur d’inférence, un budget et une validation des faits
contre le passage source. Le dépôt n’a actuellement ni runtime, ni clé, ni service de
modèle. Le score actuel offre un premier gain sans cette dépendance. Sa couverture et son
intérêt restent tributaires des articles ; les sondes réelles ont servi à calibrer les
faux positifs, et les tests utilisent exclusivement des exemples synthétiques hors réseau.

TextExtracts reste l’adaptateur déjà utilisé et reçoit seulement un format de section
différent. Sa documentation signale une maintenance restreinte. Une évolution plus large
vers le contenu HTML structuré devra préférer les API de contenu maintenues ; ce lot
n’ajoute pas une collecte complexe reposant sur cette extension.

## Déploiement et retour arrière

Appliquer la migration 0014 et redéployer web et worker ensemble. La prochaine sélection
est automatiquement préparée ; les publications existantes conservent leurs positions.
Un retour au code précédent peut conserver la colonne additive inutilisée. La suppression
de cette colonne reste optionnelle ; aucune suppression de publication ou de cache n’est
nécessaire pour revenir au code précédent.

Documentation primaire consultée :

- https://www.mediawiki.org/wiki/Extension:TextExtracts
- https://www.mediawiki.org/wiki/API:Etiquette
- https://www.mediawiki.org/wiki/API:Parsing_wikitext
- https://www.mediawiki.org/wiki/API:Revisions
