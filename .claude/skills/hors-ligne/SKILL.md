---
name: hors-ligne
description: Recette pour rendre une fonctionnalité utilisable sur téléphone sans réseau (PWA, service worker, paquet terrain en IndexedDB, file d'envoi des appels RPC, UUID générés sur l'appareil, idempotence, photos en attente, conflits 409, indicateurs). À charger dès qu'une fonctionnalité doit marcher sur le terrain, qu'on touche à sw.js, à rpcTerrain, à paquetTerrain ou à ECRITURES_TERRAIN.
---

# Hors ligne

Décision et raisons : `docs/architecture-hors-ligne.md`. Ce skill dit **comment faire**.

Base : la PWA de **Custos Domus** (https://github.com/nayosis/custos-domus : `public/sw.js`, `src/lib/push.ts`,
manifeste, `serveur/ical.ts`). En cas de doute sur l'installation, le push ou l'iCal, faire comme Custos Domus ;
seuls le cache, le paquet terrain et la file d'envoi sont propres à cette application.

## Rendre une écriture utilisable hors ligne

1. Elle doit être une **création** (ou un changement de statut simple). Sinon : la laisser en ligne uniquement.
2. Signature : `export async function creerX(id: string, donnees: …, saisiLe?: string)` — **l'id vient de
   l'appareil** (`newId()` côté client), c'est le premier argument (le journal s'en sert).
3. Idempotente : si une fiche `id` existe déjà avec le même contenu, renvoyer la fiche sans rien écrire ni
   journaliser ; si le contenu diffère → `ErreurMetier("Cette saisie a déjà été reçue avec un autre contenu.", 409)`.
4. L'ajouter à `ECRITURES_TERRAIN` (`serveur/modele.ts`).
5. Côté interface, l'appeler via `rpcTerrain(fonction, args)` (met en file si pas de réseau) plutôt que `ecrire()`.
6. Si elle doit être **visible hors ligne** juste après la saisie : l'ajouter à la fusion « paquet + file »
   (`src/lib/terrain.ts`) pour qu'elle apparaisse marquée « en attente d'envoi ».
7. Tests : double rejeu, rejeu après expiration de session, ordre photo → fiche.

## Rendre une donnée consultable hors ligne

- L'ajouter à `paquetTerrain()` (`src/data/terrain.ts`, lecture). Garder le paquet petit : projets non clos,
  contacts liés, 90 jours d'interactions, 3 derniers comptes rendus, **miniatures** (pas les originaux).
- Afficher la date de fraîcheur du paquet sur les écrans qui le lisent.
- Trésorerie : le paquet porte seulement un **résumé calculé par le serveur** (solde à l'instant T, prévu fin de
  mois, retards) ; jamais les mouvements ni les règles de calcul sur le téléphone.

## Conflits avec un seul utilisateur

L'appli n'a qu'un utilisateur : la vérification de version du socle (« modifié par quelqu'un d'autre ») ne voit
pas un conflit entre son téléphone et son ordinateur. Pour une écriture rejouée depuis la file, comparer la version
lue **quel que soit l'auteur**. Test obligatoire.

## Photos

- Réduire sur l'appareil (canvas, 2 000 px, JPEG 0,8) **avant** de stocker en IndexedDB. Pas de HEIC : la saisie
  `<input type="file" accept="image/*" capture="environment">` renvoie du JPEG sur iOS quand on passe par le canvas.
- Envoi : `POST /api/fichiers` puis appel RPC de rattachement. Un fichier envoyé mais non rattaché est purgé à
  7 jours par le socle : rattacher dans la même passe de rejeu.

## Ce qu'il ne faut pas faire

- Pas de base de données répliquée ni de moteur de synchro (décision écrite).
- Pas de logique métier dans le service worker : il ne fait que cache de la coquille (+ Web Push).
- Ne jamais vider la file sans accusé de réception du serveur. Ne jamais masquer un échec : l'écran « En attente
  d'envoi » montre chaque erreur.
- Ne pas compter sur `crypto.randomUUID` (absent hors contexte sécurisé) : utiliser `newId()` du socle.

## Vérifier à la main (Chrome DevTools)

Application → Service workers « Offline » ; saisir une visite avec 2 photos ; recharger hors ligne (l'appli
s'ouvre) ; repasser en ligne → la file se vide, la visite apparaît sur l'ordinateur via la mise à jour en direct.
Sur iPhone : tester **installée sur l'écran d'accueil**, en mode avion.
