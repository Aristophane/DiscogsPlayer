/** Catalogue français — locale de référence (SPECIFICATION.md §29). */
export const fr = {
  'app.name': 'Discogs Player',
  'app.tagline': 'Votre collection Discogs, écoutable.',

  'home.intro':
    'Parcourez votre collection comme une pile de disques, tirez un album au hasard, puis écoutez-le.',
  'home.signIn': 'Se connecter avec Discogs',
  'home.status.bootstrap': 'Fondation technique en place — Lot 0.',

  'nav.collection': 'Collection',
  'nav.random': 'Aléatoire',
  'nav.playing': 'Lecture en cours',
  'nav.settings': 'Paramètres',

  // Connexion (§6.1, §19.3 : la transparence est affichée avant l'autorisation)
  'signin.title': 'Se connecter',
  'signin.action': 'Se connecter avec Discogs',
  'signin.dataTitle': 'Ce que Discogs Player utilise',
  'signin.data.collection':
    'Votre collection Discogs : pochettes, artistes, titres, genres, styles et listes de pistes.',
  'signin.data.identity':
    'Votre identité Discogs, qui sert d’identifiant : aucun mot de passe ne vous est demandé.',
  'signin.data.events':
    'Vos écoutes et favoris, enregistrés en privé pour préparer une future fonction de découverte.',
  'signin.data.contributions':
    'Vos corrections de correspondance, partagées avec les autres utilisateurs sans jamais révéler leur auteur.',
  'signin.data.deletion':
    'Vous pouvez supprimer votre compte et vos données personnelles à tout moment depuis les paramètres.',
  'signin.error.cancelled': 'La connexion a été annulée. Vous pouvez réessayer.',
  'signin.error.expired': 'La demande de connexion a expiré. Relancez la connexion.',
  'signin.alreadySignedIn': 'Vous êtes déjà connecté.',

  // Paramètres (§7.1)
  'settings.title': 'Paramètres',
  'settings.account': 'Compte',
  'settings.account.discogs': 'Compte Discogs',
  'settings.account.role': 'Rôle',
  'settings.role.user': 'Utilisateur',
  'settings.role.admin': 'Administrateur',
  'settings.signOut': 'Se déconnecter',
  'settings.signOut.explanation':
    'La déconnexion met fin à cette session. Votre collection importée est conservée.',
  'settings.signOut.pending': 'Déconnexion…',
  'settings.signOut.failed': 'La déconnexion a échoué. Réessayez.',

  // Import (§6.1, §7.1 `/import`, §12.3 : des états compréhensibles)
  'import.title': 'Import de votre collection',
  'import.status.queued': 'En attente de démarrage…',
  'import.status.running': 'Import en cours…',
  'import.status.completed': 'Import terminé.',
  'import.status.failed': 'L’import s’est interrompu.',
  'import.status.cancelled': 'Import annulé.',
  'import.progress.pages': 'Page {processed} sur {total}',
  'import.progress.pagesUnknown': '{processed} page(s) traitée(s)',
  'import.progress.items': '{count} album(s) importé(s)',
  'import.action.start': 'Synchroniser maintenant',
  'import.action.retry': 'Relancer l’import',
  'import.action.browse': 'Voir les albums déjà disponibles',
  'import.explanation':
    'Vous pouvez consulter les premiers albums pendant que l’import se poursuit.',
  'import.error.retryable':
    'Discogs a ralenti ou refusé une page. L’import reprendra là où il s’est arrêté.',
  'import.never': 'Aucun import n’a encore été lancé.',

  'collection.title': 'Collection',
  'collection.search.label': 'Rechercher un artiste, un album, un genre',
  'collection.search.placeholder': 'Rechercher…',
  'collection.search.clear': 'Effacer la recherche',
  'collection.sort.label': 'Trier',
  'collection.sort.date_added_desc': 'Ajout récent',
  'collection.sort.artist_asc': 'Artiste (A→Z)',
  'collection.sort.title_asc': 'Titre (A→Z)',
  'collection.sort.year_desc': 'Année (récent)',
  'collection.filters.genres': 'Genres',
  'collection.filters.styles': 'Styles',
  'collection.filters.clear': 'Retirer tous les filtres',
  'collection.filters.show': 'Filtrer',
  'collection.filters.hide': 'Masquer les filtres',
  'collection.results': '{count} album(s)',
  'collection.results.filtered': '{count} album(s) sur {total}',
  'collection.loadMore': 'Afficher plus d’albums',
  'collection.loading': 'Chargement…',
  'collection.error': 'Le chargement a échoué. Réessayez.',
  'collection.noResults': 'Aucun album ne correspond à cette recherche.',
  'collection.noResults.hint': 'Essayez un autre terme ou retirez des filtres.',
  'collection.copies': '{count} exemplaires',
  'collection.cover.missing': 'Pochette indisponible',
  'collection.cover.alt': '{title}, par {artists}',

  // Fiche album (§7.4)
  'release.backToCollection': 'Retour à la collection',
  'release.tracklist': 'Pistes',
  'release.notFound': 'Cet album n’est pas dans votre collection.',
  'release.details.year': 'Année',
  'release.details.country': 'Pays',
  'release.details.formats': 'Formats',
  'release.details.genres': 'Genres',
  'release.details.styles': 'Styles',
  'release.details.discogs': 'Édition Discogs',
  'release.details.copies': 'Exemplaires',
  'release.availability': 'Disponibilité',
  'release.availability.youtube.known': '{count} vidéo(s) connue(s) via Discogs',
  'release.availability.youtube.none': 'Aucune vidéo connue pour le moment',
  'release.availability.pending':
    'La recherche d’un média n’est lancée qu’au moment où vous choisissez une piste.',
  'release.tracks.none': 'La liste des pistes n’est pas encore chargée.',
  'release.track.unknownDuration': 'Durée inconnue',
  'collection.empty': 'Votre collection est vide pour le moment.',
  'collection.count': '{count} album(s) dans votre collection.',
  'collection.sync': 'Synchroniser',
  'collection.import': 'Voir l’import',
  'collection.signedInAs': 'Connecté en tant que {username}.',

  // Accueil connecté (ADR-0006)
  'home.hub.title': 'Que voulez-vous écouter ?',
  'home.hub.collection': 'Collection',
  'home.hub.collection.hint': 'Parcourir vos {count} albums',
  'home.hub.random': 'Aléatoire',
  'home.hub.random.hint': 'Tirer un album au hasard',
  'home.hub.radio': 'Radio',
  'home.hub.radio.hint': 'Lecture continue par genre',
  'home.hub.radio.soon': 'Disponible une fois la lecture en place',

  // Aléatoire (§8.4)
  'random.title': 'Aléatoire',
  'random.filters.title': 'Filtrer le tirage',
  'random.filters.none': 'Toute la collection',
  'random.eligible': '{count} album(s) éligible(s)',
  'random.draw': 'Tirer un album',
  'random.drawAgain': 'Tirer un autre album',
  'random.progress': '{drawn} sur {total} vus dans cette session',
  'random.exhausted.title': 'Vous avez vu tous les albums éligibles.',
  'random.exhausted.hint': 'Recommencez une session pour repartir de zéro.',
  'random.restart': 'Recommencer une session',
  'random.empty': 'Aucun album ne correspond à ces filtres.',
  'random.open': 'Ouvrir la fiche',
  'random.noAutoplay': 'Le tirage n’ouvre aucun lecteur : à vous de choisir une piste.',
  'random.error': 'Le tirage a échoué. Réessayez.',

  'error.generic': 'Une erreur est survenue. Réessayez dans un instant.',
  'error.notFound': 'Cette page n’existe pas.',
} as const;
