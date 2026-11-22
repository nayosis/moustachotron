# Journal des versions

## v0.4.0 · Suivi de chantier

**Nouveau**
- **Visites de chantier** (téléphone d'abord) : dates, qui est là (présent, absent, retard, excusé, convoqué,
  destinataire), un bloc par lot (avancement, suivi, constats, observations — « ! » en tête de ligne = important),
  photos prises sur place, réserves (constatées, levées). Chaque visite reprend la précédente.
- **Rapport de visite en PDF**, sur le modèle du rapport Excel : bandeaux, présences, textes types, accès au chantier,
  formalités d'urbanisme, blocs par lot avec photos, observations importantes et réserves en rouge, signature.
  Rapport « envoyé » : figé.
- **Accès et formalités** du chantier (n° de dossier, codes, stationnement, DP, DOC, DAACT, planning).
- **Paramètres** : signataire, agence, image de signature, textes types du rapport.

**Mise à jour**
- Migrations 0004 et 0005, appliquées au démarrage.
- Déploiement : `docs/deploiement-raitchu.md` (image privée sur ghcr.io).

## v0.3.0 · Trésorerie (en cours, non publiée)

**Nouveau**
- **Trésorerie** : solde réel, solde prévu aujourd'hui, en fin de mois, à +1 mois, +3 mois (réglables) et à une
  date choisie ; détail des échéances, charges récurrentes, redevances du réseau et TVA à reverser ; courbe ; mode
  pondéré pour les projets aux devis non validés.
- **Échéancier des projets** en trésorerie dès la mission validée : facturer (n°, date, montant), encaisser
  (le mouvement est créé), annuler, changer la date ; mise à jour avec aperçu, le facturé ne bouge pas.
- **Estimation des travaux** sur le projet : acompte et prévisionnel avant les devis.
- **Prévu / réalisé** par exercice, mois et catégorie (comme la « Synthèse Année N »), trésorerie de fin de mois.
- **Mouvements** : dépenses et recettes ponctuelles avec justificatif ; **charges récurrentes** ; réglages
  (trésorerie d'ouverture et objectif de CA des exercices, horizons).
- Catégories reprises des tableurs ; exercices 2024-2025, 2025-2026, 2026-2027.

- **Relevé bancaire** : import du CSV de la banque, relecture ligne par ligne (échéance encaissée, charge
  récurrente, catégorie habituelle, doublon probable), import rejouable sans doublon.
- **Reprise des tableurs** : `bun scripts/importer-tableurs.ts "Tableau de gestion.xlsx"` (essai, puis `--ecrire`).
- Accueil : tuile **Trésorerie** (solde du jour, fin du mois).
- Prévisionnel : mouvements datés d'avance comptés à leur date ; TVA d'un mois non prévue si déjà payée.
- **Échéances manuelles** et liste **« À dater »** dans la trésorerie.
- `scripts/reprendre-chantiers.ts` : chantiers en cours repris de « Chantiers Année 3 » (reste à facturer).
- `scripts/charges-depuis-synthese.ts` : charges récurrentes proposées depuis le « Prévu » de la synthèse du tableur.

**Mise à jour**
- Nouvelles tables (migrations 0002 et 0003), appliquées au démarrage.

## v0.2.0 · Contacts et projets (non publiée)

Phase 1 du Moustachotron : suivre ses prospects et ses projets, de la première demande à la réception des travaux.

**Nouveau**
- **Aujourd'hui** : relances du jour, estimations sans réponse depuis 15 jours, jalons des 14 prochains jours,
  attestations d'assurance à renouveler.
- **Contacts** : clients (prospects tant qu'aucune mission n'est validée), entreprises, apporteurs, partenaires ;
  échanges (appel, e-mail, rendez-vous, visite, note) avec date de relance.
- **Projets** : pipeline par étape ou liste ; 12 jalons datés (prévu / réel) ; prix de la mission selon sa règle
  (AMO, MOE 15 %, courtage 6 %, Expertise au forfait, EAA 199 €) ; échéancier des honoraires calculé
  (acompte au barème, 40 % / 40 % / solde) ; commissions des entreprises ; commission d'apport.
- **Lots et devis** : plusieurs devis par lot, versions, devis retenu ; validation des devis par lot, les lots non
  validés partant dans un projet « tranche 2 » lié.
- **Documents** : croquis, plans, devis, factures, PV… ; Word et Excel acceptés ; attestations d'assurance avec
  fin de validité.

**Mise à jour**
- Base neuve (le module d'exemple « notes » du socle est retiré) : pas de données à reprendre.

## v0.1.0 · Le socle

Première version du modèle, tirée de Cura Parentum 1.0 : tout ce qui ne dépend pas du métier.

**Nouveau**
- Comptes, rôles, liens d'invitation ; journal de preuve avant / après ; traçabilité et conflits d'écriture ;
  mise à jour en direct ; fichiers ; sauvegardes de la nuit et restauration ; vérification des nouvelles versions ;
  image Docker multi-architecture.
- Module d'exemple « notes » (pièces jointes, archivage, règle réservée aux admins), à remplacer.
- Ce que le socle doit savoir du modèle tient dans deux fichiers : `serveur/modele.ts` et `src/lib/modele.ts`.
- Tous les modules de `src/data/` sont exposés par RPC, sauf `_*.ts` : plus de liste à tenir à jour en double.
- `scripts/renommer.ts` : donne son nom à une nouvelle application.
- `CLAUDE.md`, skills `cadrage`, `architecture`, `socle-technique`, gabarit `docs/conception.md`.
