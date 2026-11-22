# Questions de cadrage — soldées le 22/11/2026

Toutes les réponses sont reportées dans `conception.md`. Ce fichier garde la trace des questions posées.

## Général
- [x] **Q-G1** Nom → **Le Moustachotron**.
- [x] **Q-G2** Ordre → projets puis trésorerie.
- [x] **Q-H1** Hébergement → image Docker, instance personnelle puis VPS, HTTPS.

## Utilisateurs
- [x] **Q-U1** → seul utilisateur.
- [x] **Q-U2** → téléphone indifférent, PWA comme Custos Domus.

## Argent
- [x] **Q-T1 / T1b / T1c / T1d** → prix par mission (Expertise forfait calculé, EAA 199 € TTC, AMO/MOE 15 % du TTC
  des travaux, courtage 6 % du TTC des devis validés, audit abandonné) ; le client paie du TTC, le HT suit la TVA des
  travaux.
- [x] **Q-T2 / T2b / T2c / T2d** → acompte au barème ; AMO/MOE 40 % signature des devis / 40 % démarrage / solde
  réception, recalcul sur avenant ; courtage acompte + solde à la signature des devis ; Expertise 50/50 ; EAA 100 %
  au rapport.
- [x] **Q-T3** → commission EDB 13 % HT, en une fois au démarrage.
- [x] **Q-T4** → probabilité en option, désactivée par défaut.
- [x] **Q-T5** → recettes saisies à l'émission des factures, dépenses ponctuelles saisies, charges fixes par
  import CSV.
- [x] **Q-T6** → T, +1 mois, +3 mois + un horizon à une date choisie.
- [x] **Q-T7** → reprise de l'exercice en cours et des 2 précédents.
- [x] **Q-T8** → trésorerie en TTC, résultat en HT (proposition par défaut).

## Prospects & projets
- [x] **Q-P1 / P1b** → origine suivie, commission d'apport 10 % des honoraires HT à la réception.
- [x] **Q-P2** → 12 jalons datés (réception du prospect → réception des travaux).
- [x] **Q-P3** → un projet par tranche.
- [x] **Q-P4** → EAA = Estimation Avant Achat.
- [x] **Q-P5** → relance après 15 jours.
- [x] **Q-P6** → liste des types de documents, devis multiples et versionnés, alerte sur les attestations
  d'assurance.

## Chantier
- [x] **Q-C1 / C1b** → rapport de visite fourni : `rapport-de-visite.md`.
- [x] **Q-C2** → PDF généré, envoyé par l'utilisateur.
- [x] **Q-C3** → réserves par lot, statuts validés.
- [ ] **Q-C4** Dictée vocale : on s'appuie sur celle du clavier du téléphone (rien à développer). *Par défaut.*

## Hors ligne, fichiers, notifications
- [x] **Q-O1 / O2** → validé + trésorerie T et fin de mois hors ligne.
- [x] **Q-F1** → PDF, photos, Word, Excel.
- [x] **Q-E1** → pas de facturation dans l'outil : on **enregistre** les factures émises (n°, date, montant).
- [x] **Q-N1 / N2 / A1** → Web Push, pas d'e-mail, flux iCal.

## Restant à préciser pendant la phase 1
- Numéro de compte GitHub du dépôt (pour `scripts/renommer.ts` et l'image ghcr.io).
- Textes types du rapport de visite : reprendre ceux de l'exemple tels quels ?
