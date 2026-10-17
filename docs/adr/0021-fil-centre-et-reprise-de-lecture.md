# ADR 0021 — Pochettes au centre du fil et reprise de lecture

Demande produit du 17 octobre 2026, après revue du premier accueil.

## Présentation

L'accueil connecté commence directement par les publications. Les zones « Votre fil »,
la description, « Votre sélection du jour », la date d'édition et l'onboarding Spotify
ne précèdent plus les disques. La préférence Spotify reste disponible dans les réglages.
Le titre de page reste présent pour les lecteurs d'écran, sans occuper de place visible.

Chaque publication présente son contexte, son titre et ses artistes, puis une grande
pochette carrée centrée, suivie du texte dépliable, de la source et des actions. Le
premier visuel est chargé immédiatement et les suivants restent chargés à la demande.
Les messages de préparation sont discrets et ne repoussent pas les publications déjà
disponibles. L'onglet Stats reste dans la navigation principale.

## Reprise de lecture

Le navigateur conserve, séparément pour chaque compte, l'identifiant de la publication
visible, son décalage sous l'en-tête, le nombre de cartes chargées et les textes dépliés.
Le défilement, la navigation, la mise en arrière-plan et la fermeture sauvegardent cette
position. Le retour dans le fil, son rechargement et la réouverture de l'application
retrouvent la publication et son décalage, même après le chargement de plusieurs pages.

Les corps des publications ne sont pas copiés dans le stockage navigateur. Les pages
nécessaires sont relues via l'API authentifiée, qui revérifie les partages et les disques
encore possédés. Une collection révoquée ne peut donc pas réapparaître par une copie
locale. L'API accepte des pages de restauration de cent éléments au maximum ; les pages
ordinaires conservent douze éléments. Les curseurs restent privés à l'utilisateur.

La reprise se fait après le rendu et avant le chargement automatique de la suite. Un
geste de lecture de l'utilisateur interrompt une restauration encore en cours. Une
position introuvable, une erreur réseau ou un stockage refusé ne bloque pas la lecture
des publications encore disponibles. La restauration est bornée à vingt mille cartes.

Aucune migration supplémentaire : le changement utilise le fil et ses autorisations
existants. La position dépend du navigateur et ne se synchronise pas entre appareils.
