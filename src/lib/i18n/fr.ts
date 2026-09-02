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
  'collection.empty': 'Votre collection est vide pour le moment.',
  'collection.count': '{count} album(s) dans votre collection.',
  'collection.sync': 'Synchroniser',
  'collection.import': 'Voir l’import',
  'collection.signedInAs': 'Connecté en tant que {username}.',

  'error.generic': 'Une erreur est survenue. Réessayez dans un instant.',
  'error.notFound': 'Cette page n’existe pas.',
} as const;
