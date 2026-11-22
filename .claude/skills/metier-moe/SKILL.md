---
name: metier-moe
description: Connaissance métier d'un maître d'œuvre franchisé d'un réseau de rénovation (missions Expertise/AMO/MOE/EAA/Courtage/Audit, honoraires sur travaux, commission des entreprises EDB, lots, devis, cycle avant-vente → signature par lot → chantier → réception, comptes rendus de visite). À charger dès qu'on touche aux contacts, prospects, projets, lots, devis, échéances, visites, ou qu'on nomme un statut ou un calcul d'honoraires / commission.
---

# Métier : maîtrise d'œuvre en réseau

La référence des décisions est `docs/conception.md` ; ce skill donne le **contexte** pour bien les appliquer et poser
les bonnes questions. En cas d'écart, la conception gagne (et on signale l'écart).

## Deux canaux, deux façons de gagner de l'argent

- **Société de conseil** propre : expertises, apports d'affaires. Factures émises par la société.
- **Franchise d'un réseau de rénovation** : missions AMO, MOE, EAA, courtage, audit énergétique. Le réseau encaisse
  et reverse ; dans les relevés, l'origine des recettes est souvent le réseau, pas le client.
- Sur un chantier on gagne :
  - des **honoraires** (client) = travaux HT × taux (15 % par défaut, 12,75 % sur certaines offres) ;
  - une **commission** par entreprise retenue (EDB = entreprise du bâtiment) = travaux HT du lot × taux (13 % par
    défaut, de 5 % à 15 % observés).
- Le réseau prélève des **redevances** : fixe mensuelle, publicité mutualisée, 5 % du CA réseau, redevance assurance
  (0,5 % courtage, 3 % AMO, 7,5 % MOE). Elles sont des charges dans la trésorerie (skill `tresorerie`).

## TVA à connaître

- Travaux de rénovation de logement : **10 %** (5,5 % pour certains travaux énergétiques, 20 % pour le neuf / hors
  logement). Le taux est porté par le **lot**.
- Honoraires en % (AMO, MOE, courtage) : **même TVA que les travaux** (le HT se déduit lot par lot).
- Missions au forfait (Expertise, EAA) et commissions des entreprises : **20 %**.
- Toujours stocker HT **et** taux ; calculer TVA et TTC. Montants en centimes, arrondi au centime à chaque ligne.

## Missions

| Code | Mission | Particularité |
|---|---|---|
| EXP | Expertise | société de conseil, **forfait calculé** par projet, TVA 20 % ; 50 % commande / 50 % rapport |
| EAA | Estimation Avant Achat | **forfait 199 € TTC** (TVA 20 %) ; 100 % à la livraison du rapport |
| AMO | Assistance à maîtrise d'ouvrage | **15 %** des travaux TTC (13,5 %, 12,75 % ou forfait possibles) + commissions |
| MOE | Maîtrise d'œuvre | idem AMO ; redevance assurance plus forte |
| COU | Courtage en travaux | **6 %** du TTC des devis validés ; même acompte que l'AMO, puis **solde à la signature des devis** |
| ~~AUD~~ | Audit énergétique | **n'est plus proposé** : archivé, gardé pour l'historique |

Calculs fixés par la conception (ne pas les réinventer) :
- **Le client ne paie que du TTC** : honoraires TTC = travaux TTC × taux. **Le HT suit la TVA des travaux** :
  honoraires HT = Σ lots (TTC × taux ÷ (1 + TVA du lot)). Jamais « ÷ 1,2 » sur ces missions.
- **Acompte** TTC selon un barème des travaux TTC (< 20 k€ : 500 € ; ≤ 75 k€ : 750 € ; ≤ 100 k€ : 1 000 € ;
  au-delà : 1 500 €), paramétrable.
- **Échéancier** : acompte → 40 % à la signature des devis (acompte déduit) → 40 % au démarrage → solde à la
  réception. Avenant : échéances facturées figées, les suivantes recalculées, le solde absorbe l'écart.
- **Commission** = travaux HT du lot × 13 % (paramétrable), **en une fois au démarrage des travaux** du lot.
- **Origine** obligatoire sur chaque projet ; **commission d'apport** facultative = 10 % des honoraires HT,
  versée à la réception → échéance **sortante**.

## Cycle d'un projet

**Référence : les 12 jalons datés de `docs/conception.md`** (réception du prospect → réception des travaux) ; le
statut est le dernier jalon atteint, les échéances se calent sur les jalons. Le rapport de visite suit
`docs/rapport-de-visite.md` (cumulatif, un bloc par lot). Récit du cycle :

1. **Prospect** : premier contact (appel, formulaire, apport d'un partenaire), rendez-vous de découverte.
2. **Visite / relevé** chez le client : besoins, photos, mesures.
3. **Consultation des entreprises** par lot : on envoie le dossier, on attend les devis.
4. **Devis reçus** : un ou plusieurs par lot ; on compare.
5. **Proposition envoyée au client** (devis retenus + honoraires).
6. **Réponse** : signé tout ou **partie des lots**, perdu (motif), abandonné. Un même client peut avoir une
   « tranche 2 » : c'est un **nouveau projet** lié au premier.
7. **Chantier** : préparation, démarrage (souvent déclencheur d'une échéance d'honoraires), visites de suivi avec
   **compte rendu** (présents, avancement par lot, observations, décisions, réserves, photos).
8. **Réception** avec ou sans réserves → levée des réserves → solde des honoraires → clos.

Questions à toujours se poser sur un projet : qui est le client (contact) ? quels lots, quelles entreprises ? quel
statut et depuis quand ? quelle prochaine action et quand (relance) ? quel argent est attendu et quand (échéances) ?

## Règles de modélisation

- Prospect = **statut d'un contact**, pas une table à part (on garde l'historique quand il devient client).
- Une relance = une **interaction à faire** (date d'échéance), pas un objet séparé.
- **Un projet par tranche** : à une signature partielle, les lots non signés partent dans un nouveau projet lié
  (`projetOrigineId`). Un projet a un seul statut, jamais calculé depuis ses lots.
- **La base des honoraires dépend de la mission** (HT ou TTC des travaux, honoraires HT ou TTC) : règle portée par
  la mission dans Paramètres, jamais codée en dur.
- Les changements de statut sont **datés** (table d'étapes) : pipeline, délais, taux de transformation.
- Noms de clients réels : jamais dans le code, les tests, les maquettes ou les commits — utiliser des noms inventés.
