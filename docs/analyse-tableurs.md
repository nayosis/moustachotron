# Analyse des tableurs existants

Source : `docs/sources/*.xlsx` (données réelles du client, **hors dépôt**, cf. `.gitignore`). Analyse du 22/11/2026.
Ce document dit ce que font les tableurs aujourd'hui, et ce que l'application doit reprendre, corriger ou abandonner.

## 1. `Tableau de gestion.xlsx` — le cœur : trésorerie et plan de charge

37 onglets. Exercice comptable **de juin à mai** (« Année 1 » = juin 2024 → mai 2025, « Année 3 » = juin 2026 → mai 2027).

### 1.1 Un onglet par mois (« Octobre 2026 »…) = le grand livre de trésorerie

Une ligne par mouvement bancaire réel :

| Colonne | Sens |
|---|---|
| Date de règlement | date de passage en banque |
| Origine / Destinataire | tiers (FCH, URSSAF, CIC, client…) |
| Référence facture, date d'émission | pièce justificative |
| Mode de règlement | Virement, Prélèvement, CB, Chèque |
| Objet | libellé libre, contient souvent le **nom du chantier** (« MARTIN - Démarrage tvx ») |
| Puis ~38 paires de colonnes **H.T. / TTC** | une paire par **catégorie** (recette ou dépense) |

Catégories de **recettes** : Expertise (RC Consulting) ; puis réseau CAMIF Habitat : Commission EDB, Honoraires AMO,
Honoraires MOE, EAA, Courtage, Audits énergétiques ; plus « TVA récupérée » et « Financement » (prêt, compte courant
d'associé).

Catégories de **dépenses** (regroupées par fournisseur dans la synthèse) : franchise (redevance fixe, publicité
mutualisée, publicité nationale, redevance sur CA 5 %, commission apport d'affaires, redevance assurance, formations),
publicité locale, banque (frais, remboursement d'emprunt), comptable (honoraires, frais de société), local (loyer,
travaux, EDF, eau, téléphonie), véhicule (LOA, carburant, transport), assurances, frais divers (agence, bureautique,
hébergement-restauration, adhésions, informatique, logiciels, outillage), salaire et mutuelle, impôts et taxes (CFE).

Pied d'onglet : totaux par catégorie, balance de TVA (TTC − HT) par catégorie, **trésorerie début de mois** (= fin du
mois précédent), **variation**, **trésorerie fin de mois**.

> Problèmes constatés : la ventilation HT/TTC est faite à la main sur des dizaines de colonnes ; formules cassées ou
> incohérentes (ex. `G77 = G71+I71+Q6747+…` référence une cellule hors tableau ; `J62 = I62*1.2` codé en dur) ;
> le report de TVA pointe parfois sur le mauvais onglet (`'Septembre 2025'!G50` dans Octobre 2026).

### 1.2 « Synthèse Année N » = le prévisionnel de trésorerie

Pour chaque mois de l'exercice et chaque catégorie : **Prévu / Réalisé / Écart**.
- Prévu des **recettes** : tiré du « Plan de charge projets » (ce que les chantiers doivent rapporter ce mois-là).
- Prévu des **charges** : montant fixe mensuel saisi (loyer 920, LOA 468,15, salaire 3 515…), ou calculé
  (redevance sur CA = 5 % des recettes réseau du mois précédent ; redevance assurance = 0,5 % courtage + 3 % AMO +
  7,5 % MOE).
- Réalisé : total de l'onglet du mois.
- Bas de page : balance HT du mois, balance cumulée, **trésorerie prévisionnelle disponible en fin de mois**
  (= fin du mois précédent + produits − charges).
- Un petit **simulateur** : volume de chantiers TTC (400 k€ … 600 k€) → CA honoraires (15 %), CA commissions (13 %),
  résultat. Objectif de CA de l'exercice : **140 000 € HT**.

### 1.3 « Plan de charge projets » = l'échéancier prévisionnel des encaissements

Grille de ~180 colonnes = **semaines** (5 par mois, de juin 2024 à 2027). Une ligne par chantier et par **événement** :
« Signature devis », « Honoraires prestation », « Commission EDB ». Chantiers regroupés par **type de mission** :
Expertise, EAA, AMO, MOE, Courtage, Audit énergétique. En tête : charges prévues du mois, honoraires et commissions
encaissés, « reste à produire sur le mois ».

> C'est en réalité un **échéancier par projet**, positionné à la main sur une grille. L'application le remplace par des
> échéances datées rattachées au projet ; la grille devient une vue calculée.

## 2. `Chantiers Année 3.xlsx` — le reste à facturer

Par chantier signé : montant des travaux TTC, **honoraires** prévus, **commission** prévue, déjà facturé (honoraires,
commission), **reste à facturer**. Totaux : à facturer sur l'exercice, déjà facturé, total produits, panier moyen
chantier (~25 k€ TTC), avancement vers l'objectif (69,6 % de 140 k€).

Formules observées :
- Honoraires = **montant travaux TTC × taux ÷ 1,1** (taux 15 % ou 12,75 %) — on ramène les travaux en HT (TVA 10 %).
- Commission = **montant travaux TTC ÷ 1,1 × 13 %** (parfois 15 %, parfois saisie à la main).
- Reste à facturer = prévu − déjà facturé.
- Une section « reliquat des chantiers démarrés l'année précédente ».

## 3. `Suivi marge chantiers.xlsx` — le pipeline

Une ligne par projet : **état**, montant HT travaux, **marge EDB** (taux de commission, 5 % à 15 %), CA sur EDB,
montant TTC travaux, **taux d'honoraires**, CA sur honoraires, **date (mois) de démarrage prévue**.

États rencontrés (→ statuts du projet) : *En cours de consultation, En attente devis, En attente de validation,
Devis signé, Démarré, En cours de réalisation, Réceptionné.*

Totaux : signés vs prévus, CA HT prévu sur l'exercice (pondération implicite à 100 %).

> Incohérence tranchée le 22/11/2026 : ici CA honoraires = TTC travaux × taux **÷ 1,2**, alors que `Chantiers Année 3`
> divise par **1,1**. **C'est ÷ 1,1 (TVA des travaux) qui est juste** : le HT des honoraires suit les taux de TVA du
> chantier. La formule ÷ 1,2 surestime l'écart et n'est pas reprise.

## 4. Ce qu'on en retient pour l'application

| Tableur | Devient dans l'application |
|---|---|
| Onglets mensuels | **Mouvements** de trésorerie (saisis ou importés du relevé CSV), chacun avec une **catégorie**, HT/TVA/TTC calculés, rattachement facultatif à un projet |
| Synthèse Année N | Vue **Trésorerie** : prévu / réalisé / écart par mois et catégorie, solde projeté |
| Plan de charge | **Échéances** datées sur chaque projet (honoraires, commissions) + **charges récurrentes** paramétrées |
| Chantiers Année N | Onglet « Facturation » du projet + vue « Reste à facturer » |
| Suivi marge | **Pipeline** des projets (statuts) avec montants, taux, probabilité, date prévue |

Reprise de l'historique : import ponctuel des onglets mensuels (mouvements réalisés) et des projets en cours —
**à décider** (cf. questions).

## 5. Reprise contrôlée (22/11/2026)

Essai à blanc de `scripts/importer-tableurs.ts` sur le classeur réel : **30 mois (juin 2024 → novembre 2026),
1 284 mouvements, somme de chaque mois = « fin − début » du tableur au centime**, chaînage des mois cohérent.
Pièges rencontrés : libellés d'en-tête fusionnés (seule la première colonne d'une paire HT / TTC porte le
libellé), colonnes qui changent d'un exercice à l'autre (reconnues par libellé), pied « Totaux: » au lieu de
« Total: » (juillet 2025).
