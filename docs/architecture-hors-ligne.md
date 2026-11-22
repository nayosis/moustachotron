# Architecture : hors ligne sur téléphone

Décision proposée le 22/11/2026 (**à valider**). Elle déroge au socle (« pas de hors ligne sauf décision contraire »,
skill `architecture` § 8) : la dérogation est justifiée par le besoin écrit dans `conception.md` (saisie sur chantier
sans réseau).

## Le besoin précis

| Sur le terrain, sans réseau, il faut… | Nature |
|---|---|
| Consulter la fiche client / projet, les lots, les entreprises, les derniers comptes rendus | lecture |
| Consulter l'agenda et les relances du jour | lecture |
| Voir la trésorerie : solde à l'instant T et prévu en fin de mois | lecture (résumé calculé) |
| Rédiger un compte rendu de visite, ajouter des réserves | **création** |
| Prendre des photos rattachées à la visite | **création** (fichiers lourds) |
| Noter un rendez-vous, un appel, une relance ; créer un prospect | **création** |
| Changer un statut (« devis signé ») | modification — rare |

Constat : **presque tout ce qui se saisit hors ligne est une création**. Les créations ne se contredisent pas entre
elles ; c'est ce qui rend le hors ligne simple ici.

## Options étudiées

| | A. PWA + file d'envoi (recommandé) | B. Base locale synchronisée (PowerSync, RxDB, ElectricSQL…) | C. Application native (Capacitor / React Native) |
|---|---|---|---|
| Principe | Service worker (coquille de l'appli) + IndexedDB : un **paquet terrain** en lecture, une **file** d'appels RPC en attente | Réplique de la base sur l'appareil, synchro bidirectionnelle | Même interface emballée dans une appli des stores |
| Compatibilité socle | Totale : on garde le RPC, le journal, les droits | Remplace le RPC et le journal par le moteur de synchro | A ou B, plus un emballage |
| Dépendances | Aucune (service worker écrit à la main) ; éventuellement `idb` (1 ko) | Lourdes, souvent un service en plus | Chaîne de build mobile, comptes développeur |
| Conflits | Quasi inexistants (créations) ; 409 du socle pour les rares modifications | Règles de fusion à définir partout | idem A ou B |
| Risque | iOS : stockage d'une PWA non installée effacé après 7 jours sans visite → **installer sur l'écran d'accueil** + `navigator.storage.persist()` | Complexité, dette | Coût, publication, mises à jour |

**Choix : A.** B est disproportionné pour un utilisateur et une base de quelques Mo. **C est exclu** (décidé le
22/11/2026) : on fait comme **Custos Domus**, une PWA installable.

## Point de départ : la PWA de Custos Domus

On reprend tels quels de https://github.com/nayosis/custos-domus :
- `public/manifest.webmanifest` (installable, `display: standalone`) ;
- `public/sw.js` : réception des notifications push et ouverture de la page au toucher ;
- `src/lib/push.ts` : enregistrement du service worker, abonnement push, détection « iPhone hors appli installée »,
  nom de l'appareil ;
- côté serveur : clés VAPID créées au premier besoin, abonnements dans `comptes.db` (`web-push`, dépendance déjà
  validée dans Custos Domus) ; flux iCal (`serveur/ical.ts`) pour les rendez-vous et relances.

Ce que Custos Domus **ne fait pas** et qu'on ajoute : son service worker ne met **rien en cache** (« l'application
reste en ligne »). On lui ajoute la mise en cache de la coquille, le paquet terrain et la file d'envoi décrits
ci-dessous. Ces ajouts sont génériques : à proposer ensuite au dépôt modèle et à Custos Domus.

## Fonctionnement retenu

```
Téléphone (PWA installée, HTTPS obligatoire)
 ├─ Service worker : met en cache la coquille (HTML, JS, CSS, icônes) → l'appli s'ouvre sans réseau
 ├─ IndexedDB « terrain »
 │    ├─ paquet   : résultat de paquetTerrain() — contacts actifs, projets non clos, lots, entreprises,
 │    │             interactions récentes et à venir, 3 derniers comptes rendus par projet, miniatures
 │    ├─ file     : appels RPC en attente { id, fonction, args, saisiLe, essais, erreur? }
 │    └─ fichiers : photos en attente (Blob JPEG déjà réduit) liées à un élément de la file
 └─ Interface : lit TanStack Query ; en cas d'échec réseau, répond depuis le paquet + les saisies en file
```

1. **Paquet terrain.** Fonction de lecture `paquetTerrain()` ; rechargée à l'ouverture, au retour du réseau et sur
   un bouton « Mettre à jour pour le terrain ». Taille visée < 5 Mo hors miniatures. Date de fraîcheur affichée
   (« Données du 22/11 à 7 h 40 »). Il contient aussi un **résumé de trésorerie** calculé par le serveur : solde à
   l'instant T, solde prévu en fin de mois, encaissements en retard. Les chiffres ne sont pas recalculés sur le
   téléphone (les règles restent côté serveur) : ils sont affichés « au 22/11 à 7 h 40 ».
2. **Écritures hors ligne = liste fermée de fonctions** marquées « terrain » (`ECRITURES_TERRAIN` dans
   `serveur/modele.ts`) : `creerInteraction`, `creerProspect`, `creerVisite`, `ajouterReserve`, `ajouterPhoto`,
   `changerStatutProjet`. Toute autre écriture reste en ligne uniquement (bouton grisé « nécessite le réseau »).
3. **Identifiant fourni par l'appareil** (UUID via `crypto.getRandomValues`) et **idempotence** : rejouer deux
   fois la même création ne crée qu'une fiche (le serveur répond « déjà reçu » avec la fiche existante).
4. **Rejeu dans l'ordre**, au retour du réseau (événement `online`, ouverture de l'appli, bouton « Envoyer »).
   Les photos partent d'abord (`POST /api/fichiers`), puis l'appel RPC qui les rattache.
5. **Conflits** : les créations n'en ont pas. `changerStatutProjet` envoie la version lue (`modifieLe`) ; en cas de
   409, l'élément passe « à vérifier » et l'utilisateur choisit (garder le sien / garder celui du serveur).
   Rien n'est jamais perdu en silence.
   **Attention, un seul utilisateur** (décidé le 22/11/2026) : le socle ne signale un conflit que si la fiche a été
   modifiée **par quelqu'un d'autre** ; ici le conflit vient de ses propres appareils (statut changé sur
   l'ordinateur pendant que le téléphone était hors ligne). Pour les écritures arrivant de la file, la vérification
   de version compare donc la version **quel que soit l'auteur** (ou l'`ID_CLIENT` de l'appareil), sinon le
   téléphone écraserait l'ordinateur sans prévenir.
6. **Journal** : `saisiLe` (horloge de l'appareil) est enregistré en plus de l'heure serveur.
7. **Session** : cookie de session glissant de **30 jours** pour ne pas être déconnecté au retour du chantier ;
   si la session a expiré, la file est conservée et part après reconnexion.
8. **Indicateurs visibles** : pastille « Hors ligne », compteur « 3 saisies en attente », écran « En attente
   d'envoi » listant chaque élément et son erreur éventuelle.

## Impacts sur le socle

- `src/lib/rpc.ts` : variante `rpcTerrain()` qui met en file si le réseau manque.
- `serveur/rpc.ts` : accepter `saisiLe` et un identifiant de création fourni ; refuser hors liste `ECRITURES_TERRAIN`
  ce qui arrive avec `saisiLe`.
- Service worker : un seul fichier `public/sw.js`, celui de Custos Domus (Web Push) augmenté de la mise en cache
  de la coquille ; pas de Workbox.
- Ces améliorations sont **génériques** : à proposer au dépôt modèle Fundamentum.

## Tests attendus

- Rejouer deux fois la même création → une seule fiche, un seul passage au journal.
- File rejouée dans l'ordre, photo envoyée avant la visite qui la cite.
- `changerStatutProjet` avec version périmée → 409, élément « à vérifier », **même quand l'auteur des deux
  modifications est le même utilisateur** (téléphone contre ordinateur).
- Paquet terrain : contient le résumé de trésorerie (T et fin de mois) avec sa date de calcul.
- Fonction hors `ECRITURES_TERRAIN` envoyée avec `saisiLe` → refus.
- Session expirée pendant le rejeu → file conservée.
