# Capacités de lecture intégrée par fournisseur

Note d'évaluation technique, 2 septembre 2026. Alimente les lots 6 et 7, et les questions
v1 de `SPECIFICATION.md` §25.1.

⚠️ Les politiques et API des plateformes changent sans préavis. §28 impose de revérifier
les sources officielles avant toute intégration. Ce document est une évaluation à date,
pas une garantie.

---

## 1. Tableau de synthèse

| Fournisseur  | Lecture dans la page    | Piste entière                                                                                   | Contrôle par JS                             | Résolution automatique                                        | Verdict v0/v1          |
| ------------ | ----------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- | ---------------------- |
| **YouTube**  | oui, IFrame Player API  | oui                                                                                             | complet (play/pause/seek/événements)        | API de recherche, quota                                       | **socle v0**           |
| **Spotify**  | oui, Embed + iFrame API | **seulement si l'utilisateur est connecté en Premium dans ce navigateur** ; sinon extrait ~30 s | partiel (play/pause/seek/`playback_update`) | non — URL collée puis oEmbed                                  | **v0 dégradé**         |
| **Bandcamp** | oui, EmbeddedPlayer     | dépend du réglage de l'artiste (souvent entier)                                                 | **aucun** — iframe non scriptable           | non — pas d'API de recherche publique                         | v1 possible, sans file |
| **Deezer**   | oui, widget             | seulement Premium connecté ; sinon extrait 30 s                                                 | **SDK JS déprécié**                         | API métadonnées ouverte, mais accès développeur fermé de fait | v1 risqué              |
| **Qobuz**    | **non**                 | —                                                                                               | —                                           | API privée, sur partenariat                                   | lien externe seulement |

---

## 2. Détail par fournisseur

### YouTube — le seul socle fiable

L'IFrame Player API donne un contrôle complet : `playVideo`, `pauseVideo`, `seekTo`, et
surtout l'événement de fin de piste qui permet d'enchaîner une file (§13.6). C'est ce qui
fait de YouTube le seul fournisseur capable de soutenir une lecture continue en v0.

Trois limites structurent la conception :

- **La vidéo doit être intégrable.** Le titulaire des droits peut désactiver l'intégration ;
  la proposition devient alors invalide et doit être désactivée (§13.7).
- **Le lecteur doit rester visible.** Les Developer Policies imposent que le lecteur ne soit
  ni masqué ni recouvert, avec une taille minimale (de l'ordre de 200 × 200 px — à
  revérifier). Un « lecteur audio caché » est donc exclu, ce qui condamne d'emblée toute
  approche de type onglet fantôme (§3 ci-dessous).
- **La recherche coûte du quota**, pas la lecture. Les 1409 vidéos déjà fournies par
  Discogs pour votre collection se lisent sans consommer une seule unité (ADR-0002).

### Spotify — honnête sur ce qu'il ne peut pas faire

L'Embed lit dans la page, mais **la piste entière n'est servie qu'à un utilisateur connecté
à un compte Premium dans le même navigateur**. Sinon : un extrait d'environ 30 secondes.
L'application ne peut pas savoir dans quel cas elle se trouve — d'où l'exigence §14.7
d'annoncer la limite plutôt que de promettre une lecture.

L'API iFrame expose `play`, `pause`, `seek` et des mises à jour de position, mais l'autoplay
programmatique n'est pas garanti et une file de pistes indépendantes n'est pas fiable
(PLAY-005). D'où la préférence pour la correspondance **d'album** : Spotify enchaîne alors
lui-même les pistes (§14.6).

#### Connexion Spotify : deux sens du mot, un seul est utile en v0

« Demander à l'utilisateur de se connecter » recouvre deux mécanismes sans rapport, et
seul le second débloque la lecture intégrale dans l'Embed.

**OAuth Spotify** relie le compte de l'utilisateur à _notre_ application. C'est un
non-objectif v0 explicite (§3.2) et une question v1 ouverte (§25.2). Surtout : **cela ne
change rien à l'Embed**. Le lecteur intégré ne consulte aucun jeton que nous détiendrions ;
il se fie à la session du navigateur sur `open.spotify.com`.

**Être connecté à Spotify dans le même navigateur** est ce qui débloque réellement la
piste entière. Aucun OAuth, aucune clé, aucune validation Spotify, aucune donnée
personnelle reçue de leur part. C'est une étape d'onboarding, pas une intégration.

_Décision retenue_ : proposer, pendant l'onboarding, un lien vers `open.spotify.com` pour
que l'utilisateur s'y connecte, avec retour vers l'application. Étape **facultative et
passable**, rejouable depuis les paramètres.

**Trois limites à énoncer honnêtement dans l'interface :**

- **Nous ne pouvons pas vérifier que c'est fait.** Aucune API ne nous dit si la session
  Spotify existe ni si le compte est Premium. Afficher un badge « connecté » serait un
  mensonge. Tout au plus peut-on _inférer_ après coup : une piste dont l'Embed annonce une
  durée d'environ 30 secondes alors que la piste en dure quatre est un extrait.
- **Les restrictions sur les cookies tiers peuvent l'empêcher.** Dans un iframe tiers,
  Safari bloque par défaut l'accès aux cookies de `open.spotify.com` ; Chrome durcit sa
  politique. Sur iOS — cible principale d'une PWA mobile-first — la lecture intégrale
  Spotify peut donc échouer **même pour un abonné Premium correctement connecté**.
- **Cela confirme le rôle de YouTube comme socle.** Spotify reste un complément
  opportuniste, jamais une dépendance sur laquelle promettre une lecture.

**L'échelle suivante, si Spotify devient central (v1, §25.2)** : le _Web Playback SDK_
donne une lecture intégrale pilotable en JavaScript, réservée aux comptes Premium et
adossée à un vrai OAuth. C'est la seule voie fiable — au prix d'une inscription développeur
soumise à validation, dont l'obtention n'est pas acquise.

### Bandcamp — lecture oui, pilotage non

L'EmbeddedPlayer officiel lit dans la page, souvent l'album entier selon ce que l'artiste a
autorisé. Deux obstacles :

- **Aucune API JavaScript** : l'iframe n'est pas scriptable depuis notre origine. Pas
  d'événement de fin de piste, donc **pas d'enchaînement automatique**, pas de file.
- **Aucune API de recherche publique** : la résolution ne peut être que manuelle, par URL
  collée — le même parcours que Spotify en v0.

Intérêt réel malgré tout : c'est le seul fournisseur où la lecture intégrale ne dépend ni
d'un abonnement ni d'une connexion, ce qui en fait un bon complément pour les disques
indépendants et les rééditions que YouTube ignore.

### Deezer — la porte s'est refermée

Le widget lit dans la page, mais le SDK JavaScript qui permettait de le piloter est
déprécié, et l'accès développeur n'est plus ouvert en pratique. La lecture intégrale exige
là aussi un compte Premium connecté. L'API de métadonnées reste consultable et expose des
extraits de 30 s, dont la rediffusion est encadrée par les conditions d'utilisation.

À traiter comme une **dépendance à risque** : intégrer Deezer, c'est parier sur une
plateforme dont l'ouverture aux tiers recule.

### Qobuz — lien externe uniquement

Pas de lecteur intégrable public, API réservée aux partenaires sous accord. La seule
intégration honnête est un lien « Ouvrir dans Qobuz ». Cela reste utile pour un public
audiophile, mais ne relève pas de la lecture intégrée.

---

## 3. L'onglet fantôme : techniquement impossible et contractuellement interdit

L'idée — ouvrir un onglet en arrière-plan qui joue la piste sans que l'utilisateur voie
l'interface sauter — se heurte à cinq obstacles indépendants, dont chacun suffit à la
condamner.

1. **On ne choisit pas l'arrière-plan.** `window.open()` ouvre un onglet, mais c'est le
   navigateur qui décide du focus. Ouvrir en arrière-plan est un geste de l'utilisateur
   (clic milieu, Ctrl+clic), pas une capacité de l'API.
2. **Il faut un geste utilisateur, sinon c'est bloqué.** Hors interaction directe, le
   bloqueur de fenêtres surgissantes intervient. Une radio qui enchaîne les titres ne peut
   donc pas ouvrir un onglet par piste.
3. **On ne peut pas piloter une page d'une autre origine.** Depuis notre onglet, on ne peut
   ni lire l'état de `youtube.com`, ni le mettre en pause, ni savoir que la piste est
   terminée. La file interne deviendrait aveugle.
4. **L'autoplay avec son est refusé** dans un onglet qui vient de s'ouvrir sans activation
   préalable. Le résultat serait un onglet muet.
5. **C'est interdit.** Les politiques YouTube exigent un lecteur officiel, visible et non
   recouvert. Masquer la lecture est exactement ce qu'elles proscrivent — et §3.2 de la
   spécification exclut déjà tout contournement de ce type.

### Ce qui répond réellement au besoin

Le besoin derrière la question — « que l'interface ne saute pas d'un onglet à l'autre » —
est déjà résolu, et par la bonne méthode : **le lecteur persistant monté dans le layout
racine** (SPEC-GAPS G-17, en place depuis le Lot 0).

Un `<iframe>` monté au-dessus des routes n'est jamais démonté lors d'une navigation. La
lecture continue pendant que l'utilisateur parcourt sa collection, ouvre une fiche album ou
lance un tirage. C'est un « onglet fantôme » au sens utile du terme : un contexte de lecture
indépendant de la page consultée — sauf qu'il est visible, scriptable, conforme, et qu'il
survit aux navigations mieux qu'un onglet réel.

La forme visible recommandée est la **barre de lecture réduite** : le lecteur occupe une
bande basse persistante, dépliable en plein écran sur `/lecture`. Elle satisfait la
contrainte de visibilité de YouTube tout en laissant la collection occuper l'écran.

---

## 4. Conséquence sur la friction

Le vrai coût de démarrage d'une piste n'est pas la navigation, c'est **la résolution du
média**. Pour une piste déjà associée, la lecture démarre immédiatement. Pour une piste
inconnue, il faut une recherche YouTube — soumise au quota, et parfois à un choix humain
entre candidats (§15.3).

D'où une règle de conception pour tout mode « lecture immédiate » : **tirer en priorité
parmi les pistes déjà résolues**. Sur votre collection, 1409 vidéos Discogs sont déjà
connues avant tout appel d'API : de quoi alimenter une lecture continue sans jamais
toucher au quota.
