# Conception — Le Moustachotron

Cadrage mené le 22/11/2026 (**version 0.2 — cadrage terminé**, nom choisi le 22/11/2026). Socle technique et
architecture : skills `socle-technique` et `architecture` (modèle Fundamentum). Métier : skills `metier-moe`,
`tresorerie`, `hors-ligne`. Analyse de l'existant : [analyse-tableurs.md](analyse-tableurs.md). Rapport de visite :
[rapport-de-visite.md](rapport-de-visite.md). Choix d'architecture
hors ligne : [architecture-hors-ligne.md](architecture-hors-ligne.md). Maquettes : [maquettes/maquette.html](maquettes/maquette.html).
Patte graphique : **vert ardoise** (couleur `marque`) sur fonds gris chauds, pour ne pas confondre avec les autres
applications du modèle.

> Ce qui n'est pas tranché est marqué **À décider** et renvoie à une question de [questions-cadrage.md](questions-cadrage.md).

## Le besoin

Un maître d'œuvre indépendant gère seul (au départ) une petite entreprise qui vit de deux canaux : sa société de
conseil (expertises, apports d'affaires) et une **franchise d'un réseau de rénovation** par laquelle passent ses
missions d'AMO, de MOE, de courtage et d'audit énergétique. Il gagne de l'argent de deux façons sur un chantier :
des **honoraires** payés par le client, et une **commission** versée par chaque entreprise du bâtiment (EDB) retenue.

Aujourd'hui tout tient dans trois tableurs Excel : un grand livre mensuel ventilé à la main dans ~40 colonnes, une
synthèse prévu / réalisé, un plan de charge hebdomadaire positionné à la main, un suivi du reste à facturer et un
suivi des marges. Les prospects, rendez-vous, relances, devis et comptes rendus de chantier ne sont suivis nulle part
de façon structurée. Sur le terrain (chez le client, sur le chantier), il n'a souvent **pas de réseau**.

L'application doit lui permettre de :
1. **voir sa trésorerie** aujourd'hui, dans 1 mois et dans 3 mois (horizons paramétrables), prévu contre réalisé ;
2. **suivre ses prospects** : contacts, rendez-vous, relances, puis le projet en avant-vente (consultation des
   entreprises, devis reçus, devis envoyés au client, réponse), jusqu'à la signature (éventuellement **par lot**) ;
3. **suivre ses chantiers** : statut, visites avec compte rendu et photos ;
4. **saisir sur le téléphone sans réseau** (comptes rendus, photos, notes de rendez-vous) et consulter ses dossiers
   en cours hors ligne.

## Vocabulaire (devient celui du code)

| Terme | Sens | Identifiant |
|---|---|---|
| Contact | personne ou société (client, prospect, entreprise, partenaire) | `contact` |
| Prospect | contact client pas encore signé ; c'est un **statut** du contact, pas une autre table | — |
| Interaction | trace datée d'un échange : appel, email, rendez-vous, visite, note | `interaction` |
| Relance | interaction **planifiée** non faite (date d'échéance) | `interaction.aFaireLe` |
| Projet | une affaire chez un client, de l'avant-vente à la réception ; le « chantier » est la phase après signature | `projet` |
| Mission | type de prestation : Expertise, AMO, MOE, EAA (Estimation Avant Achat), Courtage (l'audit énergétique est archivé) ; porte sa règle de prix et son échéancier | `mission` |
| Origine | d'où vient le projet (réseau, site, bouche-à-oreille, apporteur…) | `projet.origine` |
| Apporteur | contact qui a apporté l'affaire, éventuellement rémunéré (commission d'apport) | `projet.apporteurId` |
| Lot | corps d'état du projet (maçonnerie, électricité…) confié à une entreprise | `lot` |
| Entreprise (EDB) | entreprise du bâtiment qui réalise un lot et verse la commission | `contact` de type entreprise |
| Devis | devis d'une entreprise pour un lot (reçu, transmis, accepté, refusé) | `devis` |
| Échéance | encaissement prévu : honoraires (acompte, démarrage, solde) ou commission | `echeance` |
| Mouvement | ligne réelle de trésorerie (banque) | `mouvement` |
| Catégorie | poste de recette ou de charge (cf. tableurs) | `categorie` |
| Charge récurrente | dépense prévue qui revient (loyer, LOA, salaire…) | `charge_recurrente` |
| Visite | rendez-vous de chantier avec compte rendu, réserves, photos | `visite` |

## Modèle

```
Contact (client / prospect / entreprise / partenaire)
 ├─ Interactions (0..n)  — appel, email, RDV, visite, note ; faite ou à faire (relance)
 └─ Projets (0..n, côté client)
      ├─ Projet d'origine (0..1) — la tranche précédente du même client
      ├─ Étapes (changements de statut datés)
      ├─ Lots (0..n) ── Entreprise (contact) ── Devis (0..n) ── Fichiers
      ├─ Origine + Apporteur (contact, 0..1)
      ├─ Échéances (0..n) — entrantes (acompte, honoraires, commission) ou sortantes (commission d'apport),
      │                     prévue → facturée → réglée ── Mouvement (0..1)
      ├─ Visites (0..n) — compte rendu, réserves, Photos (0..n)
      └─ Documents (0..n) — plans, devis, contrats, PV de réception…

Mouvement (date, tiers, mode, objet, catégorie, HT / TVA / TTC, projet?) ── justificatif (0..1)
Catégorie (recette | charge | TVA | financement, groupe, taux de TVA par défaut)
Charge récurrente (catégorie, montant, périodicité, début, fin) → génère le prévu des charges
Exercice (début, fin, objectif de CA, trésorerie d'ouverture)
```

- **Montants en centimes**, dates ISO, identifiants UUID **générés sur l'appareil** (indispensable au hors ligne).
- **Rien n'est supprimé** : archivage (`archive = 1`), comme dans le socle.
- Taux en **points de base** (1 500 = 15 %) pour rester en entiers.
- Valeurs de départ (migration 0001) : catégories issues des tableurs, missions et leur règle de prix, barème
  d'acompte, échéanciers, origines, statuts, taux par défaut (honoraires 15 %, courtage 6 %, commission 13 %,
  apport 10 %, TVA travaux 10 %, TVA des missions au forfait 20 %).

### Statuts du projet (cycle de vie)

Décidé le 22/11/2026 (Q-P2) : le cycle est une suite de **jalons datés** ; le statut du projet est **le dernier
jalon atteint**. Une date peut être prévue (grisée) puis réelle.

| # | Jalon | Remarque |
|---|---|---|
| 1 | Réception du prospect | date d'arrivée de la demande, origine |
| 2 | Contact du prospect | premier échange |
| 3 | Visite initiale | **une 2e visite possible** (date facultative) |
| 4 | Remise de l'estimation | |
| 5 | Validation de la mission | déclenche l'**acompte** |
| 6 | Signature du contrat | |
| 7 | Lancement de la consultation | entreprises consultées par lot |
| 8 | Réception des devis | |
| 9 | Validation des devis | lots non validés → projet « tranche 2 » ; déclenche les **40 %** (courtage : solde) |
| 10 | Lancement du projet (préparation de chantier) | |
| 11 | Démarrage des travaux | déclenche **40 %** + commissions des entreprises |
| 12 | Réception des travaux | avec / sans réserves ; déclenche le **solde** et la commission d'apport |

Après la réception : **Réserves levées → Clos** (cf. Suivi de chantier). Sorties possibles à tout moment avant le
jalon 9 : **Perdu** (motif) ou **Abandonné**. Les échéances se datent automatiquement sur les jalons prévus et se
recalent quand le jalon réel est saisi.

- **Un projet par tranche** (décidé le 22/11/2026, Q-P3) : à la signature, on coche les lots signés ; ils restent
  dans le projet, qui passe en chantier. Les lots non signés partent dans un **nouveau projet « tranche 2 »** lié au
  premier (`projet.projetOrigineId`), qui reste en avant-vente avec son propre statut. Un projet a donc **un seul
  statut**, jamais calculé depuis ses lots.
- Chaque changement de statut est daté (historique d'étapes) : sert aux délais moyens et au pipeline.

## Règles métier

### Montants d'un projet
- Montant des travaux saisi **TTC par lot** (devis entreprise), HT déduit avec le taux de TVA du lot (10 % par défaut).
- **Le prix de la mission dépend de la mission** (décidé le 22/11/2026, Q-T1 / Q-T1b). Chaque mission porte dans
  Paramètres un **mode** (forfait ou pourcentage des travaux), un taux ou un forfait par défaut, et son taux de TVA
  (20 %). Le projet hérite de ces valeurs et peut les modifier (taux 13,5 %, 12,75 %… ou forfait).

  | Mission | Mode par défaut | Valeur par défaut | Acompte (barème) | Échéancier |
  |---|---|---|---|---|
  | Expertise | forfait calculé, saisi par projet, TVA 20 % | — | non | 50 % à la commande, 50 % à la livraison du rapport |
  | EAA (Estimation Avant Achat) | forfait, TVA 20 % | **199 € TTC** | non | 100 % à la livraison du rapport |
  | AMO | % des travaux TTC | **15 %** | oui | acompte → 40 % signature → 40 % démarrage → solde réception |
  | MOE | % des travaux TTC | **15 %** | oui | idem AMO |
  | Courtage | % du **montant TTC des devis validés** | **6 %** | oui | acompte → **solde à la signature des devis** |

  **L'audit énergétique n'est plus proposé** (décidé le 22/11/2026) : la mission est archivée ; la catégorie de
  trésorerie reste pour l'historique.

- **Mission en % des travaux (AMO, MOE, Courtage)** — décidé le 22/11/2026 (Q-T1d) :
  - **Le client ne voit et ne paie que du TTC** : honoraires TTC = Σ travaux TTC des lots × taux.
  - **Le HT (trésorerie, CA) suit les taux de TVA des travaux** : honoraires HT = Σ par lot (travaux TTC du lot ×
    taux ÷ (1 + TVA du lot)) = Σ travaux HT × taux. Exemple : 100 000 € TTC tout à 10 % → client 15 000 € TTC,
    HT 13 636 € ; un chantier mêlant 10 % et 5,5 % donne un taux de TVA moyen pondéré. Confirmé par les relevés
    (acompte 500 € TTC = 454,54 € HT). La formule « ÷ 1,2 » de `Suivi marge` est **fausse** et n'est pas reprise.
  - Chaque échéance porte ainsi son TTC (facturé au client) et son HT au taux moyen du projet.
- Missions sans travaux (Expertise, EAA) : pas de lots, pas de commission, TVA 20 %.
- **Commission** (décidé le 22/11/2026, Q-T3) = travaux HT du lot × **13 %** (taux par défaut dans Paramètres,
  modifiable par lot), **versée en une fois au démarrage des travaux** du lot : une échéance par lot, datée du
  démarrage prévu, recalée quand le démarrage réel est saisi.
- **Acompte d'honoraires** (décidé le 22/11/2026, Q-T2) : montant TTC selon le **barème** des travaux TTC du projet,
  paramétrable dans Paramètres :

  | Travaux TTC | Acompte TTC |
  |---|---|
  | < 20 000 € | 500 € |
  | ≤ 75 000 € | 750 € |
  | ≤ 100 000 € | 1 000 € |
  | > 100 000 € | 1 500 € |

  Échéance dès l'accord du client (avant la signature des devis).
- **Échéancier des honoraires en %** (décidé le 22/11/2026, Q-T2b), parts paramétrables dans Paramètres :
  1. **Acompte** (barème ci-dessus) ;
  2. **40 % à la signature des devis**, acompte déduit (40 % du total TTC − acompte ; si l'acompte dépasse, le
     reste se reporte sur l'échéance suivante) ;
  3. **40 % au démarrage des travaux** ;
  4. **Solde à la réception** (100 % − ce qui a été facturé).
  Vérifié sur les relevés : 1 581,88 € HT d'honoraires → acompte 454,55 + complément 178,21 = 632,76 (40 %),
  puis 632,75 au démarrage.
- **Recalcul en cours de chantier** : quand un lot est ajouté ou son montant modifié (avenant), le total des
  honoraires est recalculé ; les échéances **déjà facturées ne bougent pas** ; les échéances à venir sont
  recalculées avec leurs pourcentages sur le nouveau total, et le **solde absorbe l'écart**. Le recalcul est
  journalisé (avant / après) et proposé, pas imposé : l'utilisateur le valide.
- **Missions au forfait** (Q-T2c) : Expertise 50 % à la commande + 50 % à la livraison du rapport ; EAA 100 % à la
  livraison du rapport.
- Reste à facturer = prévu − facturé, par projet et total.

### Trésorerie
- Solde réel = trésorerie d'ouverture de l'exercice + somme des mouvements TTC.
- Prévisionnel à une date D = solde réel aujourd'hui + échéances prévues non encaissées ≤ D (pondérées par la
  probabilité du statut si l'option est cochée) − charges récurrentes ≤ D − TVA à payer estimée.
- Horizons affichés : **aujourd'hui**, **+1 mois**, **+3 mois** — **paramétrables** (liste de durées dans
  Paramètres) — **plus un horizon à une date choisie** (calendrier, décidé le 22/11/2026, Q-T6).
- Probabilité des projets non signés (Q-T4, validé) : option désactivée par défaut ; quand elle est cochée, les deux
  chiffres (certain / pondéré) sont affichés.

### Décisions prises en développant la phase 2 (22/11/2026, à valider)
- **Estimation des travaux** (champ du projet, saisi à la remise de l'estimation) : sert au barème d'acompte et au
  prévisionnel tant qu'aucun devis n'est retenu ; remplacée par les devis retenus ensuite.
- **Échéancier en base** créé à la validation de la mission (ou la signature du contrat), mis à jour à la
  validation des devis, puis sur demande (« Mettre à jour l'échéancier », avec aperçu). Ce qui est facturé ou réglé
  ne bouge pas ; l'acompte réellement facturé est celui déduit des 40 %.
- Échéances datées par **leur jalon** (date réelle, sinon prévue), ou par une date forcée.
- Commissions des entreprises facturées **à 20 %** ; commission d'apport **sans TVA** (apporteur souvent
  particulier) — **à confirmer**.
- **TVA** : due le 25 du mois suivant (réglable) sur réalisé + prévu du mois ; un crédit n'est pas prévu en
  remboursement. **Redevances** du réseau payées le 15 du mois suivant, à 20 %.
- **Mode pondéré** : avant la validation des devis, les échéances qui en dépendent comptent pour 50 % (réglable).
- **Relevé bancaire** : chaque ligne est proposée comme encaissement d'une échéance (même montant), charge
  récurrente (mot-clé ou montant) ou catégorie habituelle du tiers (apprise des mouvements précédents) ; un
  mouvement de même montant à ± 3 jours est signalé comme doublon probable ; import d'un seul tenant, rejouable.
- **Reprise des tableurs** : script `scripts/importer-tableurs.ts` (essai à blanc, puis `--ecrire`), colonnes
  reconnues par leur libellé ; trésorerie d'ouverture de chaque exercice = début de juin du tableur. Une ligne datée
  hors du mois de son onglet (ligne recopiée, faute de frappe) est ramenée au même jour dans le mois de l'onglet, date
  d'origine notée dans l'objet : les totaux mensuels restent ceux du tableur. Reprise faite dans la base locale le
  22/11/2026 (1 284 mouvements, solde fin novembre au centime près).
- **Mouvements datés après aujourd'hui** (repris ou saisis d'avance) : hors du solde réel, comptés à leur date
  dans le prévisionnel.
- **TVA déjà payée** : si un paiement de TVA est enregistré le mois M+1, la TVA estimée du mois M n'est pas prévue
  en plus.
- **Charges récurrentes initiales** (22/11/2026) : déduites du « Prévu » de la Synthèse Année 3 (HT) et des
  mouvements réels (TTC, jour, fournisseur) par `scripts/charges-depuis-synthese.ts` ; 32 charges créées par l'API.
  À relire par le client : assurances à 921,05 € / mois dès janvier (valeur du tableur), publicité locale de mai.
- **Échéances saisies à la main** (code « manuelle: ») : hors du calcul de l'échéancier, jamais retirées par sa mise à
  jour ; datées par un jalon ou une date forcée. Liste **« À dater »** dans la trésorerie : ce qui attend une date
  pour entrer dans le prévisionnel. « À facturer sous 30 jours » n'inclut plus les retards (listés à part).
- **Reprise des chantiers en cours** (22/11/2026) : `scripts/reprendre-chantiers.ts` depuis « Chantiers Année 3 » :
  14 projets, reste à facturer 25 678,82 € d'honoraires et 27 555,32 € de commissions HT (totaux du classeur),
  en échéances manuelles ; honoraires au jalon « réception », commissions au « démarrage » ; jalons atteints datés
  d'après les mouvements qui citent le client. Le « Plan de charge » du tableur ne contenait presque rien de futur
  (une ligne) : les dates sont à poser dans l'application.
- **Fin du mois** : toujours affichée après « Aujourd'hui », y compris sur téléphone.
- Échéances **en retard** (date passée, non réglées) : affichées à part, pas comptées dans le prévu.

### Saisie du réalisé (décidé le 22/11/2026, Q-T5)
- **Recettes : saisie manuelle au fil de l'émission des factures** : on facture une échéance (n° et date de facture,
  montant TTC) → elle passe « facturée » ; on note ensuite l'encaissement (date, mode) → « encaissée », ce qui crée
  le mouvement. Une recette hors projet se saisit directement.
- **Dépenses ponctuelles : saisie manuelle** de la facture (fournisseur, catégorie, HT / TVA / TTC, date, mode,
  justificatif photo ou PDF).
- **Charges fixes : import du relevé CSV** pour pointer les prélèvements récurrents contre les charges récurrentes
  prévues (rapprochement), sans ressaisie.
- Montants : trésorerie en **TTC**, résultat et CA en **HT** (Q-T8, proposition par défaut retenue).
- Prévu / réalisé / écart par mois et par catégorie, comme la « Synthèse Année N ».
- Charges calculées : redevance sur CA = 5 % des recettes réseau du mois M-1 ; redevance assurance = 0,5 % courtage
  + 3 % AMO + 7,5 % MOE (paramétrables).
- Détails : skill `tresorerie`.

### Origine et commission d'apport

- Décidé le 22/11/2026 (Q-P1) : chaque projet a une **origine** obligatoire (liste paramétrable : réseau, site
  internet, bouche-à-oreille, apporteur, partenaire, autre) et, facultatif, un **apporteur** (contact).
- **Commission d'apport facultative** (décidé le 22/11/2026, Q-P1b) : par défaut **10 % des honoraires HT** du
  projet (taux paramétrable, ou montant fixe saisi), **versée à la réception des travaux** → **échéance sortante**
  du projet (catégorie de charge « Commission apport d'affaires »), comptée dans le prévisionnel et recalculée avec
  les honoraires.
- Apport **de ton côté** (tu apportes une affaire à un tiers) : marginal → pas de circuit dédié, une échéance
  entrante libre sur le projet (catégorie « Apport d'affaires » des recettes Expertise).
- Statistiques : nombre de projets, taux de signature et CA par origine.

### Avant-vente et relances
- Toute interaction peut avoir une date « à faire le » : c'est une relance. Liste « À relancer » triée par date.
- Un prospect sans interaction depuis N jours (30 par défaut) remonte dans « Prospects dormants ».
- Un projet en « En attente de réponse » depuis N jours (15 par défaut) propose une relance.

### Verrouillage
- Un mouvement rapproché d'une échéance ne se modifie plus qu'en annulant le rapprochement.
- Un compte rendu de visite **envoyé** (PDF partagé) n'est plus modifiable ; on ajoute un additif.

## Fichiers et documents du projet

- Formats (Q-F1, validé) : photos JPEG (réduites sur l'appareil, 2 000 px max), PDF, Word et Excel. 20 Mo max.
- **Types de documents** (décidé le 22/11/2026, Q-P6), chacun rattaché au projet et, si utile, à un lot :

  | Type | Rattachement | Particularité |
  |---|---|---|
  | Croquis | projet | |
  | Descriptif des travaux | projet | |
  | Plans avant travaux | projet | |
  | Plans travaux | projet | |
  | Devis entreprise | lot + entreprise | **plusieurs devis par lot** (entreprises concurrentes) et **plusieurs versions** par devis |
  | Devis signé | lot | la version retenue ; fixe le montant du lot |
  | Facture entreprise | lot | à **valider** par le maître d'œuvre avant paiement du client |
  | Facture validée | lot | date de validation = jalon du lot |
  | Suivi des règlements client | projet | tableau des paiements du client aux entreprises (acomptes, compte séquestre, déblocages) |
  | Attestation d'assurance | entreprise | **date de fin de validité**, **alerte** avant échéance (30 jours par défaut) et sur les projets en cours de l'entreprise |
  | PV de réception | projet | date = jalon 12 |

- Les **devis** sont des fiches (lot, entreprise, version, montant TTC, TVA, date, statut reçu / retenu / refusé)
  avec leur PDF ; le devis retenu fixe le montant du lot. Les **factures d'entreprises** aussi (montant, validée le).
- Hors ligne : les photos prises sans réseau sont gardées sur le téléphone jusqu'à l'envoi (cf. architecture).

## Journal (preuve)

- Socle : chaque écriture journalisée, fiche avant / après, journal non modifiable.
- En plus : pour une écriture **saisie hors ligne**, le journal garde l'heure de saisie sur l'appareil **et** l'heure
  de réception par le serveur.

## Suivi de chantier

- Décidé le 22/11/2026 (Q-C1) : le suivi se fait aujourd'hui dans un **tableur Excel**, pénible à remplir et à
  mettre en forme, mais **son contenu est le bon** : les champs de la visite et du compte rendu reprennent ceux de ce
  tableur, **plus les photos**. Le tableur (anonymisé) est **à fournir** dans `docs/sources/` pour fixer la liste des
  champs (**À décider**, Q-C1b).
- Exemple fourni le 22/11/2026 (rapport de visite n°5, PDF) : **spécification complète dans
  [rapport-de-visite.md](rapport-de-visite.md)** — rapport cumulatif d'une visite à l'autre, présences des
  intervenants, un bloc par lot (avancement %, constats, observations importantes, photos), formalités
  d'urbanisme, textes types, signature. Q-C1b soldée.
- **Statuts de chantier** (Q-C3, validés) : Préparation → En cours → Réception (avec / sans réserves) → Réserves
  levées → Clos.
- **Réserves suivies par lot** (Q-C3, validé) : description, photo(s), lot / entreprise, date de constat, **date de
  levée**. La réception « avec réserves » liste les réserves ouvertes ; « Réserves levées » exige qu'elles soient
  toutes levées.

## Exports

- **Compte rendu de visite** en PDF (logo, participants, observations, réserves, photos) — décidé le 22/11/2026
  (Q-C2) : **l'appli génère le PDF, l'utilisateur l'envoie lui-même** au client et aux entreprises (pas d'envoi
  d'e-mail par le serveur en V1). Le CR est marqué « envoyé » à la main ; il n'est alors plus modifiable.
- Export CSV des mouvements d'un exercice pour le comptable.
- **À décider** (Q-E1) : facturation dans l'outil ou non (aujourd'hui les factures réseau sont émises par la franchise).

## Comptes

- Socle : rôles lecture, écriture, admin, super admin (gardés tels quels, sans écran de plus).
- Décidé le 22/11/2026 (Q-U1) : **un seul utilisateur**, le gérant (super admin). Pas de droits par projet, pas de
  vue comptable en V1 (l'export CSV suffit).
- Conséquence : les conflits d'écriture ne viennent pas d'autres personnes mais de **ses propres appareils**
  (téléphone hors ligne contre ordinateur), cf. architecture hors ligne.

## Téléphone et ordinateur

- **Comme Custos Domus** (décidé le 22/11/2026) : pas d'application native, une **PWA installable** (manifeste,
  `public/sw.js`, `src/lib/push.ts` repris de https://github.com/nayosis/custos-domus), photo prise depuis le
  téléphone, notifications Web Push, flux iCal. Android ou iPhone indifférent ; sur iPhone, installer l'appli sur
  l'écran d'accueil.
- **Hors ligne : oui**, en plus de Custos Domus (dont le service worker ne met rien en cache) : décision contraire
  au défaut du socle, cf. [architecture-hors-ligne.md](architecture-hors-ligne.md).
- Téléphone (terrain) : agenda du jour, fiche contact / projet en lecture, nouvelle interaction, nouvelle visite
  (compte rendu dicté ou tapé, photos), changement de statut simple, « À relancer ».
- Hors ligne, validé le 22/11/2026 (Q-O1, Q-O2) : consulter projets non clos, contacts, lots, entreprises, agenda,
  relances **et un résumé de trésorerie : solde à l'instant T et solde prévu en fin de mois** (calculés par le
  serveur au chargement du paquet, avec leur date) ; saisir visite, CR, photos, réserves, interaction / relance,
  nouveau prospect, changement de statut.
- Ordinateur : trésorerie, mouvements et import bancaire, paramètres, pipeline complet, échéancier, exports.
- Barre du téléphone (3 entrées) : **Aujourd'hui**, **Projets**, **Contacts** ; bouton « + » : visite, interaction,
  photo, prospect.

## Notifications et agenda

- Décidé le 22/11/2026 (Q-N1) : **Web Push** sur le téléphone, comme Custos Domus : relances du jour, échéances
  en retard, **attestations d'assurance** bientôt périmées. Tournée quotidienne du serveur (8 h).
- **Pas d'e-mail** (Q-N2).
- **Flux iCal** en lecture par lien secret (Q-A1), comme Custos Domus : rendez-vous, visites, relances, jalons
  prévus.

## Hors V1

- Facturation et devis émis par l'outil (si la franchise les émet déjà).
- Rapprochement bancaire automatique (connexion bancaire DSP2).
- Agenda synchronisé dans les deux sens (Google / Outlook) — le flux iCal en lecture de Custos Domus suffit.
- Application native (stores) — exclue : PWA comme Custos Domus.
- Multi-utilisateurs avec droits par projet.

## Plan (proposition, par phases livrables)

0. **Cadrage et maquettes** — *fait le 22/11/2026* : ce document, questions, maquette cliquable.
1. **Socle + Contacts & Projets (en ligne)** — *fait le 22/11/2026 (v0.2.0, non publiée)* : renommage, thème, schéma V1, catégories ; contacts, interactions,
   relances ; projets, statuts, lots, devis, documents ; pipeline. Bases du hors ligne posées dès ici : **UUID
   côté appareil et fonctions d'écriture idempotentes**.
2. **Trésorerie** — *2a fait le 22/11/2026 (prévisionnel, échéancier, factures, règlements, mouvements, charges,
   prévu / réalisé, réglages) ; 2b fait le 22/11/2026 : import du relevé CSV et rapprochement, script de reprise des tableurs
   (contrôlé au centime sur 30 mois), tuile trésorerie sur l'accueil* : exercices, catégories, factures émises et encaissements, dépenses ponctuelles, charges
   récurrentes et rapprochement CSV, échéances des projets, vue prévu / réalisé, horizons T / +1 / +3 mois / date
   choisie, reste à facturer. **Reprise de l'historique des tableurs : exercice en cours + les 2 précédents**
   (juin 2024 → aujourd'hui, décidé le 22/11/2026, Q-T7) ; les onglets de mars à mai 2024 restent dans Excel.
3. **Chantier + hors ligne terrain** — *3a fait le 22/11/2026 (visites, rapport PDF, réserves, accès et
   formalités, paramètres du rapport) ; 3b à faire : hors ligne* : visites, comptes rendus, réserves, photos, PDF ; PWA hors ligne (paquet
   terrain en lecture, file d'envoi des saisies, photos en attente).
4. **Confort** : notifications de relance, tableau de bord, exports comptable, réglages fins.
5. **Publication** : dépôt, **image Docker** ghcr.io (livrable de référence, décidé le 22/11/2026), déployée sur
   l'instance personnelle du client puis éventuellement un VPS, derrière un reverse proxy **HTTPS** (obligatoire pour
   le hors ligne, l'installation PWA et les notifications).

Ordre **décidé le 22/11/2026** (Q-G2) : projets avant trésorerie, pour que le prévisionnel se calcule depuis les
échéances des projets.
