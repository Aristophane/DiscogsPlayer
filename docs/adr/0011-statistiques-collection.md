# Statistiques communautaires et tops personnels

Demande produit du 18 septembre 2026 : afficher `community.have` et `community.want`
sur les albums et deux tops personnels sur l'accueil. Cette demande étend les exclusions
initiales des statistiques de marché dans les tuiles (§7.3).

L'appel `/releases/{id}?curr_abbr=EUR` fournit les compteurs, `lowest_price` et
`num_for_sale`. Les cinq éditions les plus recherchées sont classées par `want` ;
les cinq éditions les mieux valorisées par le prix minimum proposé, parmi celles
ayant des annonces. Ce classement ne représente ni le prix médian des ventes passées,
ni une estimation de l'exemplaire personnel. L'interface nomme cette base de calcul.

Le catalogue partagé conserve des valeurs nullables et une date de relevé. Un zéro
est une donnée, une absence reste inconnue. Une absence vérifiée n'est pas réessayée
en boucle. Fraîcheur : 24 h ; l'accueil et la synchronisation programment les relevés
manquants/périmés via la file existante, avec déduplication et conservation du backoff.
Le worker passe par le régulateur Discogs. Les relevés seuls ne touchent jamais les
pistes ni leurs correspondances. Les imports complets alimentent aussi les compteurs.

Les classements filtrent les instances actives du propriétaire connecté, dédupliquent
les éditions et départagent les égalités par titre puis identifiant. Pendant la visite
d'une collection amie, ouvrir un élément du top revient à sa collection personnelle.

Déploiement : appliquer `npm run db:migrate`, redémarrer le serveur et le worker.
La migration 0010 est additive. Les collections existantes se complètent lors d'une
visite à l'accueil ou d'une synchronisation. Le bouton d'actualisation relit le cache.
Retour arrière : revenir au code précédent ; les colonnes ajoutées peuvent rester
sans effet. Pour les supprimer, sauvegarder leurs données puis retirer uniquement
`community_have`, `community_want`, `lowest_price_eur`, `num_for_sale` et
`statistics_fetched_at` de `discogs_releases` dans une nouvelle migration.

Référence : https://minim.readthedocs.io/en/latest/_modules/minim/discogs.html#API.get_release
