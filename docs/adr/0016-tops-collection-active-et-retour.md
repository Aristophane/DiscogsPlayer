# 0016 — Tops de la collection affichée et retour à sa collection

Date : 2026-09-18. Statut : accepté, à la demande de l’utilisateur.

Les tops de l’accueil suivent désormais la collection choisie dans le header,
y compris celle d’un ami. Cette décision remplace leur périmètre exclusivement
personnel dans les ADR 0011 et 0012. Les deux classements, la demande d’actualisation
et leur polling utilisent le propriétaire actif validé par la session serveur.
Aucun identifiant de propriétaire transmis par le client n’est accepté par l’API.
Le composant est remonté lors du changement de collection pour interrompre son
ancien polling et afficher les nouvelles données. Les fiches s’ouvrent dans cette
même collection. Une collection amie vide ne propose pas d’import personnel.

« Revenir à ma collection » navigue vers `/collection` après la mutation de session,
puis actualise le contexte partagé. Recharger la fiche courante pouvait produire
une 404 lorsque le disque appartenait uniquement à l’ami. Un échec de mutation
conserve la fiche et propose de réessayer avec un message d’erreur.

La scène du bac occupe les trois quarts de la largeur sur grand écran et toute la
largeur sur mobile/tablette. Les commandes de rangement sont regroupées sur une
ligne et les informations du disque restent secondaires. Les interactions et
l’animation de sortie restent celles de l’ADR 0015.

Aucune modification du modèle de données : pas de migration nécessaire pour ce
correctif. Les parcours navigateur couvrent le retour depuis une édition exclusive
à un ami, les tops amis et leur actualisation, la révocation, les collections vides,
ainsi que les interactions du bac sur mobile, tablette et ordinateur.
