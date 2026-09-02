# ADR-0006 — Écran d'accueil, mode Radio et connexion Spotify

- Date : 2026-09-02
- Statut : accepté — **décisions produit validées par le porteur du produit**
- Amende : `SPECIFICATION.md` RAND-006, PLAY-007, §6.1, §7.1, §7.2

## Contexte

Objectif énoncé : réduire au maximum la friction entre le moment où l'on choisit une
musique et celui où elle est lue. Cet objectif entre en conflit direct avec deux exigences
normatives, et la spécification ne prévoit pas d'écran d'accueil pour un utilisateur
connecté (§7.1 se contente d'une redirection vers la collection).

Un ADR ne peut pas modifier seul une décision produit (CLAUDE.md). Les points 1 et 2
ci-dessous ont donc été soumis puis validés explicitement avant d'être consignés ici.

## Décisions

### 1. Écran d'accueil à trois entrées

Une fois l'import terminé, l'utilisateur connecté arrive sur un accueil offrant trois
destinations, et non directement sur la grille :

- **Collection** — parcours par pochettes (§7.3) ;
- **Aléatoire** — tirage d'un album (§8.4) ;
- **Radio** — lecture continue, éventuellement filtrée par genre.

La barre de navigation mobile de §7.2 (Collection / Aléatoire / Lecture en cours) reste
inchangée : l'accueil est une porte d'entrée, pas une quatrième destination permanente.

### 2. Radio : la lecture immédiate devient légitime, le tirage reste silencieux

**RAND-006** (« un tirage affiche l'album sans lancer automatiquement de média ») et
**PLAY-007** (« le lecteur ne doit jamais démarrer à la suite d'un simple tirage
aléatoire ») restent **inchangés pour le mode Aléatoire**. Leur intention — ne pas
surprendre l'utilisateur, ne pas dépenser de quota sans son accord — est préservée.

Le mode **Radio** constitue une exception explicite : y entrer _est_ l'action délibérée de
lancer une lecture. Ce n'est pas « un simple tirage » au sens de PLAY-007, c'est une
demande d'écoute. La lecture démarre donc sans étape intermédiaire.

Formulation à reporter dans la spécification lors de sa prochaine révision :

> **RAND-006** — Un tirage en mode Aléatoire affiche l'album sans lancer automatiquement de
> média. Le mode Radio fait exception : y entrer constitue la demande de lecture.
>
> **PLAY-007** — Le lecteur ne démarre jamais à la suite d'un tirage en mode Aléatoire.

### 3. La radio puise d'abord dans les pistes déjà résolues

Contrainte de conception, pas de présentation : le coût de démarrage d'une piste n'est pas
la navigation mais la résolution du média. Une radio qui tirerait au hasard dans toute la
collection épuiserait le quota YouTube en quelques dizaines de titres et imposerait des
choix manuels entre candidats (§15.3) au milieu d'une écoute.

Ordre de tirage retenu :

1. pistes ayant une correspondance connue — préférence utilisateur, proposition globale,
   ou vidéo fournie par Discogs (§13.1, étapes 1 à 3) ;
2. à défaut seulement, et si le quota le permet, une piste non résolue.

Sur une collection de 351 albums, 1409 vidéos Discogs sont connues sans aucun appel d'API :
la radio fonctionne donc à quota nul dans le cas courant, y compris quota épuisé (§6.6).

### 4. Connexion Spotify proposée à l'onboarding — sans OAuth

L'Embed Spotify ne sert la piste entière qu'à un utilisateur connecté à un compte Premium
**dans le même navigateur**. Un OAuth Spotify ne changerait rien à ce comportement : le
lecteur intégré se fie à la session `open.spotify.com`, pas à un jeton détenu par nous.
L'onboarding propose donc un simple lien de connexion, et **aucun OAuth n'est introduit** —
le non-objectif §3.2 reste respecté, et nous ne recevons aucune donnée Spotify.

L'étape est **facultative, passable et rejouable** depuis les paramètres : ajouter une
étape bloquante à l'onboarding contredirait l'objectif de friction minimale qui motive cet
ADR.

Trois honnêtetés obligatoires dans l'interface (§14.7) :

- ne jamais afficher un état « connecté » : nous ne pouvons pas le vérifier ;
- annoncer que la lecture peut se limiter à un extrait ;
- ne pas présenter Spotify comme une garantie — les restrictions sur les cookies tiers
  (Safari par défaut, Chrome en durcissement) peuvent empêcher l'Embed de voir la session
  même pour un abonné Premium, en particulier sur iOS.

## Conséquences

- Le Lot 4 livre le mode Aléatoire tel que spécifié, sans lecture automatique.
- Le mode Radio dépend de la résolution : il ne peut être livré qu'après le Lot 6.
  L'accueil peut afficher l'entrée Radio plus tôt, désactivée avec une explication.
- L'ordre de tirage de la radio impose au module `random` de connaître l'état de résolution
  d'une piste : il interrogera le service du module `resolution`, sans lire ses tables
  (isolation des modules, CLAUDE.md).
- `SPECIFICATION.md` doit être révisée sur RAND-006, PLAY-007, §6.1 et §7.1. En attendant,
  la hiérarchie ADR > SPEC-GAPS > SPECIFICATION.md s'applique.

## Alternatives écartées

- **Lancer la lecture depuis le mode Aléatoire** : contredit l'intention de RAND-006 sans
  bénéfice, puisque la Radio couvre déjà le besoin d'écoute immédiate.
- **OAuth Spotify dès la v0** : non-objectif explicite, sans effet sur l'Embed, et soumis à
  une validation Spotify incertaine.
- **Étape Spotify bloquante à l'onboarding** : ajoute de la friction au parcours dont la
  raison d'être est précisément de la supprimer.

### Addendum (2026-09-02) — Web Playback SDK explicitement reporté

Question posée après coup : un OAuth Spotify ne permettrait-il pas un vrai lecteur intégré
plutôt que l'Embed ? Réponse : si, via le *Web Playback SDK* — mais ce n'est pas « OAuth »
au sens où le point 4 ci-dessus l'écarte (un simple lien de connexion sans jeton). Le SDK
exige un OAuth complet, un compte **Premium** (le SDK ne fonctionne pas du tout sur un
compte gratuit), une application développeur déclarée, et surtout l'**Extended Quota Mode**
de Spotify pour dépasser 25 utilisateurs — une revue manuelle à l'issue incertaine.

Décision : reporté, pas écarté. Détail dans `docs/LECTURE-FOURNISSEURS.md` §2, sous-section
Spotify. Reconsidérer si Spotify devient central au produit (§25.2).
