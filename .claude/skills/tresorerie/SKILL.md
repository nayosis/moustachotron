---
name: tresorerie
description: Règles de calcul de la trésorerie prévisionnelle et réalisée (exercice juin→mai, catégories issues des tableurs, mouvements HT/TVA/TTC, échéances de projets, charges récurrentes et calculées, horizons T/+1/+3 mois paramétrables, prévu/réalisé/écart, reste à facturer, import CSV bancaire, reprise des tableurs Excel). À charger pour tout code ou toute question sur les montants, la TVA, le prévisionnel, les catégories, les mouvements ou l'import de l'historique.
---

# Trésorerie

Source des décisions : `docs/conception.md` § Trésorerie. Existant analysé : `docs/analyse-tableurs.md`.

## Principes

- **Tout en centimes**, entiers. Taux en points de base (1 000 = 10 %). Arrondi au centime **par ligne**, jamais
  sur un total recalculé.
- Un **mouvement** = un passage en banque (réel). Une **échéance** = un encaissement attendu (projet). Une **charge
  récurrente** = une dépense attendue. Le prévisionnel ne mélange jamais les trois dans une même table.
- **Exercice** de juin à mai (paramètre : mois de début). Trésorerie d'ouverture saisie par exercice.
- Les calculs sont des **fonctions pures** dans `src/lib/tresorerie.ts` (testables sans base), appelées par les
  fonctions de lecture de `src/data/tresorerie.ts`.

## Calculs

```
soldeReel(date)          = ouverture + Σ mouvements.ttc (date ≤ date)
prevu(horizon)           = soldeReel(aujourd'hui)
                           + Σ échéances non encaissées, date prévue ∈ ]aujourd'hui, horizon]  × probabilité?
                           − Σ occurrences des charges récurrentes ∈ ]aujourd'hui, horizon]
                           − charges calculées (redevance CA, redevance assurance)
                           ± TVA à payer estimée (collectée − déductible du mois, payée le mois suivant)
echeancesEnRetard        = échéances non encaissées dont la date prévue < aujourd'hui (affichées à part, pas
                           comptées dans le prévu par défaut : elles faussent la vue)
resteAFacturer(projet)   = Σ honoraires prévus + Σ commissions prévues − Σ facturé
```

- **Horizons** : liste paramétrable (défaut `[0, 30, 90]` jours, affichés « Aujourd'hui », « +1 mois », « +3 mois »).
- Les échéances ont un **sens** : entrantes (acompte, honoraires, commission EDB) ou **sortantes** (commission
  d'apport à un apporteur) ; les sortantes se retranchent du prévu comme une charge.
- Les commissions EDB tombent **au démarrage des travaux** du lot : quand la date de démarrage bouge, l'échéance
  bouge avec elle (et la vue prévisionnelle aussi).
- **Probabilité** par statut de projet (option, défaut désactivée) : signé 100 %, proposition envoyée 50 %,
  consultation 20 %… Toujours afficher les deux chiffres (certain / pondéré) quand l'option est active.
- **Redevance sur CA** = 5 % des recettes réseau HT du mois M-1. **Redevance assurance** = 0,5 % courtage + 3 % AMO
  + 7,5 % MOE des honoraires HT du mois. Taux dans Paramètres.

## Où est quoi

- Calculs purs : `src/lib/tresorerie.ts` (`fluxPrevus`, `projection`, `serie`, `occurrences`) et `src/lib/prix.ts`.
- Échéancier en base : `src/data/_echeances.ts` (`echeancesCibles`, `planifier`) ; RPC : `src/data/echeances.ts`.
- Vue, prévu / réalisé, mouvements, charges, exercices : `src/data/tresorerie.ts` ; écran : `src/pages/Tresorerie.tsx`.
- Relevé bancaire : lecture `src/lib/releve.ts`, propositions et import `src/data/releve.ts`, écran
  `src/components/ImportReleve.tsx`.
- Reprise des tableurs : `scripts/reprise/xlsx.ts` (lecteur xlsx avec fflate), `scripts/reprise/tableurs.ts`
  (onglet mensuel → mouvements), `scripts/importer-tableurs.ts` (essai / --ecrire).
- Tests : `tests/tresorerie.test.ts` (pur), `tests/echeances.test.ts`, `tests/releve.test.ts`, `tests/reprise.test.ts`.

## Vue prévu / réalisé (remplace « Synthèse Année N »)

Lignes = catégories groupées (Produits : expertise, réseau… ; Charges : franchise, banque, local…), colonnes = mois
de l'exercice × (Prévu, Réalisé, Écart). Bas : balance du mois, balance cumulée, trésorerie fin de mois.
Écart négatif sur une recette ou positif sur une charge → couleur d'alerte.

## Import

- **Relevé bancaire CSV** : colonnes date, libellé, montant ; règles de catégorisation par mots-clés (« URSSAF » →
  Charges sociales) apprises à chaque correction ; doublons détectés par (date, montant, libellé).
- **Reprise des tableurs** (une fois) : script `scripts/importer-tableurs.ts` lisant les onglets mensuels
  (ligne 5 → « Total: ») ; chaque paire de colonnes HT/TTC non vide → un mouvement de la catégorie de l'en-tête
  (lignes 2-3). Les tableurs réels restent dans `docs/sources/` (hors dépôt).
- Pièges vus dans les tableurs : formules cassées, report de TVA vers le mauvais mois, `×1,2` en dur. L'import prend
  les **valeurs**, puis un rapport liste les mois dont le total importé diffère du total du tableur.

## HT des honoraires (piège des tableurs)

Les honoraires en % sont facturés TTC au client ; leur HT se calcule **au taux de TVA des travaux** (10 % le plus
souvent, 5,5 % sur certains lots), pas à 20 %. Une échéance garde donc TTC **et** HT, avec le taux moyen pondéré du
projet. Seules les missions au forfait (Expertise, EAA) et les commissions des entreprises sont à 20 %.

## Tests obligatoires

Arrondis par ligne, horizon 0 = solde réel, échéance en retard exclue du prévu, charge récurrente mensuelle sur
un mois de 28 jours, changement d'exercice au 1er juin, import idempotent (rejouer = aucun doublon),
HT d'un projet mêlant 10 % et 5,5 %, acompte supérieur aux 40 % (report), avenant après démarrage (solde absorbe).
