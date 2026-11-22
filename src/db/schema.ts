import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/*
 * Schéma de la base métier (data/donnees.db). Les comptes et les sessions sont à part (data/comptes.db, serveur/comptes.ts).
 * Dates : chaînes ISO « AAAA-MM-JJ ». Montants : entiers en centimes. Identifiants : UUID.
 * Après modification : bun run db:generate (nouvelle migration dans drizzle/), puis serveur/modele.ts.
 */

const id = () => text("id").primaryKey();
const creeLe = () => text("cree_le").notNull().default(sql`(datetime('now'))`);

/**
 * Qui a créé / modifié la ligne, et quand (ISO, à la milliseconde). Remplies par le serveur
 * (déclencheurs SQLite, cf. serveur/tracabilite.ts) ; `modifieLe` sert aussi de version (conflits).
 * À mettre sur toute table métier, déclarée ensuite dans TABLES_SUIVIES (serveur/modele.ts).
 */
const tracabilite = () => ({
  creePar: text("cree_par"),
  modifiePar: text("modifie_par"),
  modifieLe: text("modifie_le"),
});

// --- Socle

/** Réglages de l'application, avec les données (donc sauvegardés) : clé → valeur (texte ou JSON). */
export const parametre = sqliteTable("parametre", {
  cle: text("cle").primaryKey(),
  valeur: text("valeur").notNull(),
});

/**
 * Journal des modifications : une ligne par action d'écriture (fonction appelée, par qui, sur quoi).
 * `avant` / `apres` : la fiche entière (JSON) avant et après l'écriture, pour prouver ce qui a changé.
 */
export const journal = sqliteTable(
  "journal",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    quand: text("quand").notNull(),
    utilisateur: text("utilisateur").notNull(),
    fonction: text("fonction").notNull(),
    cible: text("cible"),
    resume: text("resume"),
    avant: text("avant"),
    apres: text("apres"),
  },
  (t) => [index("journal_quand_idx").on(t.quand), index("journal_utilisateur_idx").on(t.utilisateur), index("journal_cible_idx").on(t.cible)],
);

// --- Référentiels (valeurs de départ : drizzle/0001_valeurs.sql ; réglables dans Paramètres)

/**
 * Mission proposée (Expertise, EAA, AMO, MOE, Courtage…) et sa règle de prix (conception § Montants d'un projet).
 * `mode` : « forfait » (prix TTC fixe, TVA `tvaPb`) ou « pourcentage » (taux des travaux TTC, TVA des travaux).
 * `echeancier` : JSON des encaissements, cf. src/lib/prix.ts.
 */
export const mission = sqliteTable("mission", {
  code: text("code").primaryKey(),
  libelle: text("libelle").notNull(),
  mode: text("mode", { enum: ["forfait", "pourcentage"] }).notNull(),
  /** Taux par défaut en points de base (1 500 = 15 %), mode pourcentage. */
  tauxPb: integer("taux_pb"),
  /** Forfait TTC par défaut en centimes (null : calculé au cas par cas). */
  forfaitTtc: integer("forfait_ttc"),
  /** TVA des missions au forfait (2 000 = 20 %) ; null : celle des travaux. */
  tvaPb: integer("tva_pb"),
  avecTravaux: integer("avec_travaux", { mode: "boolean" }).notNull(),
  avecAcompte: integer("avec_acompte", { mode: "boolean" }).notNull(),
  echeancier: text("echeancier").notNull(),
  ordre: integer("ordre").notNull().default(0),
  archive: integer("archive", { mode: "boolean" }).notNull().default(false),
  ...tracabilite(),
});

/** D'où vient un projet (réseau, site, bouche-à-oreille, apporteur…). */
export const origine = sqliteTable("origine", {
  code: text("code").primaryKey(),
  libelle: text("libelle").notNull(),
  ordre: integer("ordre").notNull().default(0),
  archive: integer("archive", { mode: "boolean" }).notNull().default(false),
  ...tracabilite(),
});

// --- Contacts et interactions

/**
 * Une personne ou une société : client (prospect tant qu'aucune mission n'est validée), entreprise du
 * bâtiment, apporteur, partenaire. Archivé plutôt que supprimé.
 */
export const contact = sqliteTable(
  "contact",
  {
    id: id(),
    type: text("type", { enum: ["client", "entreprise", "apporteur", "partenaire", "autre"] }).notNull(),
    /** Nom affiché : « Famille Martin », « Élec Ouest ». */
    nom: text("nom").notNull(),
    /** Personne à joindre (représentant d'une entreprise, conjoint…). */
    interlocuteur: text("interlocuteur"),
    /** Corps d'état d'une entreprise (« Électricité »). */
    corpsEtat: text("corps_etat"),
    telephone: text("telephone"),
    email: text("email"),
    adresse: text("adresse"),
    notes: text("notes"),
    archive: integer("archive", { mode: "boolean" }).notNull().default(false),
    creeLe: creeLe(),
    ...tracabilite(),
  },
  (t) => [index("contact_type_idx").on(t.type)],
);

// --- Projets

/**
 * Une affaire chez un client, de la réception du prospect à la réception des travaux. Son statut est son dernier
 * jalon atteint (table `jalon`). Une validation partielle des devis crée un projet « tranche 2 » lié.
 */
export const projet = sqliteTable(
  "projet",
  {
    id: id(),
    /** Référence lisible, attribuée à la création : « 2026-014 ». */
    reference: text("reference").notNull(),
    intitule: text("intitule").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => contact.id, { onDelete: "restrict" }),
    missionCode: text("mission_code")
      .notNull()
      .references(() => mission.code, { onDelete: "restrict" }),
    origineCode: text("origine_code")
      .notNull()
      .references(() => origine.code, { onDelete: "restrict" }),
    apporteurId: text("apporteur_id").references(() => contact.id, { onDelete: "restrict" }),
    /** Tranche précédente du même client (validation partielle des devis). */
    projetOrigineId: text("projet_origine_id"),
    adresse: text("adresse"),
    /** Montant estimé des travaux TTC (remise de l'estimation) : sert au barème d'acompte et au prévisionnel tant qu'aucun devis n'est retenu. */
    estimationTtc: integer("estimation_ttc"),
    /** Taux d'honoraires du projet (pb) : null = celui de la mission. */
    tauxPb: integer("taux_pb"),
    /** Forfait TTC du projet (centimes) : remplace le pourcentage s'il est saisi. */
    forfaitTtc: integer("forfait_ttc"),
    /** Commission d'apport (pb des honoraires HT) ; null = pas de commission. */
    tauxApportPb: integer("taux_apport_pb"),
    /** N° de dossier du chantier (en-tête du rapport de visite). */
    numeroDossier: text("numero_dossier"),
    /** Accès au chantier (rapport de visite) : clés, codes, horaires — donnée sensible, jamais dans une notification. */
    accesConditions: text("acces_conditions"),
    accesStationnement: text("acces_stationnement"),
    accesStockage: text("acces_stockage"),
    /** Urbanisme : JSON { depotDp, acceptationDp, affichage, arreteDp, docDeposee, daactDeposee, prescriptions, planning }. */
    urbanisme: text("urbanisme"),
    issue: text("issue", { enum: ["en_cours", "perdu", "abandonne"] }).notNull().default("en_cours"),
    motifIssue: text("motif_issue"),
    notes: text("notes"),
    archive: integer("archive", { mode: "boolean" }).notNull().default(false),
    creeLe: creeLe(),
    ...tracabilite(),
  },
  (t) => [index("projet_client_idx").on(t.clientId), uniqueIndex("projet_reference_idx").on(t.reference)],
);

/**
 * Trace d'un échange (appel, e-mail, rendez-vous, visite, note). `aFaireLe` sans `faite` = une relance à faire.
 */
export const interaction = sqliteTable(
  "interaction",
  {
    id: id(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "restrict" }),
    projetId: text("projet_id").references(() => projet.id, { onDelete: "restrict" }),
    nature: text("nature", { enum: ["appel", "email", "rdv", "visite", "sms", "note"] }).notNull(),
    /** Date de l'échange (ou du rendez-vous prévu). */
    date: text("date").notNull(),
    heure: text("heure"),
    objet: text("objet").notNull(),
    texte: text("texte"),
    /** Relance : date à laquelle il faut y revenir. */
    aFaireLe: text("a_faire_le"),
    faite: integer("faite", { mode: "boolean" }).notNull().default(false),
    archive: integer("archive", { mode: "boolean" }).notNull().default(false),
    creeLe: creeLe(),
    ...tracabilite(),
  },
  (t) => [index("interaction_contact_idx").on(t.contactId), index("interaction_projet_idx").on(t.projetId), index("interaction_a_faire_idx").on(t.aFaireLe)],
);

/** Jalon daté d'un projet (cf. JALONS, src/lib/jalons.ts) : date prévue et / ou réelle. */
export const jalon = sqliteTable(
  "jalon",
  {
    id: id(),
    projetId: text("projet_id")
      .notNull()
      .references(() => projet.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    datePrevue: text("date_prevue"),
    dateReelle: text("date_reelle"),
    ...tracabilite(),
  },
  (t) => [uniqueIndex("jalon_projet_code_idx").on(t.projetId, t.code)],
);

/** Lot (corps d'état) d'un projet, confié à une entreprise. Montant : celui du devis retenu. */
export const lot = sqliteTable(
  "lot",
  {
    id: id(),
    projetId: text("projet_id")
      .notNull()
      .references(() => projet.id, { onDelete: "restrict" }),
    numero: integer("numero").notNull(),
    corpsEtat: text("corps_etat").notNull(),
    entrepriseId: text("entreprise_id").references(() => contact.id, { onDelete: "restrict" }),
    /** TVA des travaux du lot (1 000 = 10 %). */
    tvaPb: integer("tva_pb").notNull().default(1000),
    /** Commission de l'entreprise (pb du HT, 1 300 = 13 %). */
    commissionPb: integer("commission_pb").notNull().default(1300),
    /** Montant TTC retenu (devis retenu), centimes. */
    montantTtc: integer("montant_ttc"),
    archive: integer("archive", { mode: "boolean" }).notNull().default(false),
    ...tracabilite(),
  },
  (t) => [index("lot_projet_idx").on(t.projetId)],
);

/** Devis d'une entreprise pour un lot : plusieurs par lot, plusieurs versions ; un seul retenu. */
export const devis = sqliteTable(
  "devis",
  {
    id: id(),
    lotId: text("lot_id")
      .notNull()
      .references(() => lot.id, { onDelete: "restrict" }),
    entrepriseId: text("entreprise_id")
      .notNull()
      .references(() => contact.id, { onDelete: "restrict" }),
    reference: text("reference"),
    version: integer("version").notNull().default(1),
    date: text("date").notNull(),
    montantTtc: integer("montant_ttc").notNull(),
    statut: text("statut", { enum: ["recu", "retenu", "refuse"] }).notNull().default("recu"),
    archive: integer("archive", { mode: "boolean" }).notNull().default(false),
    creeLe: creeLe(),
    ...tracabilite(),
  },
  (t) => [index("devis_lot_idx").on(t.lotId)],
);

/**
 * Fichier rattaché à un projet (et éventuellement à un lot ou un devis), ou à une entreprise (attestation
 * d'assurance, avec date de validité). Jamais effacé : retiré = archivé (preuve).
 */
export const document = sqliteTable(
  "document",
  {
    id: id(),
    projetId: text("projet_id").references(() => projet.id, { onDelete: "restrict" }),
    lotId: text("lot_id").references(() => lot.id, { onDelete: "restrict" }),
    devisId: text("devis_id").references(() => devis.id, { onDelete: "restrict" }),
    contactId: text("contact_id").references(() => contact.id, { onDelete: "restrict" }),
    /** Justificatif d'un mouvement de trésorerie (facture d'une dépense). */
    mouvementId: text("mouvement_id"),
    /** Photo prise lors d'une visite de chantier (avec, si besoin, le lot). */
    visiteId: text("visite_id"),
    /** Cf. TYPES_DOCUMENTS (src/lib/documents.ts). */
    type: text("type").notNull(),
    nom: text("nom").notNull(),
    fichier: text("fichier").notNull(),
    mime: text("mime").notNull(),
    taille: integer("taille").notNull(),
    /** Fin de validité (attestation d'assurance). */
    valideJusquAu: text("valide_jusqu_au"),
    archive: integer("archive", { mode: "boolean" }).notNull().default(false),
    creeLe: creeLe(),
    ...tracabilite(),
  },
  (t) => [index("document_projet_idx").on(t.projetId), index("document_contact_idx").on(t.contactId)],
);

export type Mission = typeof mission.$inferSelect;
export type Origine = typeof origine.$inferSelect;
export type Contact = typeof contact.$inferSelect;
export type Interaction = typeof interaction.$inferSelect;
export type Projet = typeof projet.$inferSelect;
export type Jalon = typeof jalon.$inferSelect;
export type Lot = typeof lot.$inferSelect;
export type Devis = typeof devis.$inferSelect;
export type Document = typeof document.$inferSelect;

// --- Trésorerie (phase 2, conception § Trésorerie)

/** Exercice comptable (juin → mai) : bornes, trésorerie d'ouverture (TTC, centimes), objectif de CA HT. */
export const exercice = sqliteTable("exercice", {
  id: id(),
  libelle: text("libelle").notNull(),
  debut: text("debut").notNull(),
  fin: text("fin").notNull(),
  tresorerieOuverture: integer("tresorerie_ouverture").notNull().default(0),
  objectifCaHt: integer("objectif_ca_ht"),
  ...tracabilite(),
});

/**
 * Poste de recette ou de dépense (repris des tableurs). `sens` : recette (+), depense (−), tva et financement
 * (signe saisi). `groupe` : regroupement de la vue prévu / réalisé (« Réseau », « Local », « Véhicule »…).
 * `id` lisible (« hono_amo ») : stable, cité par le code (échéances des projets).
 */
export const categorie = sqliteTable("categorie", {
  id: id(),
  libelle: text("libelle").notNull(),
  groupe: text("groupe").notNull(),
  sens: text("sens", { enum: ["recette", "depense", "tva", "financement"] }).notNull(),
  /** TVA par défaut à la saisie (pb). */
  tvaPb: integer("tva_pb").notNull().default(2000),
  ordre: integer("ordre").notNull().default(0),
  archive: integer("archive", { mode: "boolean" }).notNull().default(false),
  ...tracabilite(),
});

/**
 * Mouvement réel de trésorerie (un passage en banque). Montants signés, en centimes : positifs en recette, négatifs
 * en dépense. Créé par l'encaissement d'une échéance, une saisie, l'import d'un relevé ou la reprise des tableurs.
 */
export const mouvement = sqliteTable(
  "mouvement",
  {
    id: id(),
    date: text("date").notNull(),
    tiers: text("tiers"),
    mode: text("mode", { enum: ["virement", "prelevement", "cb", "cheque", "especes", "autre"] }).notNull().default("virement"),
    objet: text("objet").notNull(),
    categorieId: text("categorie_id")
      .notNull()
      .references(() => categorie.id, { onDelete: "restrict" }),
    ht: integer("ht").notNull(),
    tva: integer("tva").notNull(),
    ttc: integer("ttc").notNull(),
    projetId: text("projet_id").references(() => projet.id, { onDelete: "restrict" }),
    chargeRecurrenteId: text("charge_recurrente_id"),
    /** Référence de la facture (fournisseur ou émise). */
    reference: text("reference"),
    dateEmission: text("date_emission"),
    source: text("source", { enum: ["saisie", "echeance", "releve", "reprise"] }).notNull().default("saisie"),
    /** Clé d'import (relevé, reprise) : rejouer un import ne crée pas de doublon. */
    cleImport: text("cle_import"),
    archive: integer("archive", { mode: "boolean" }).notNull().default(false),
    creeLe: creeLe(),
    ...tracabilite(),
  },
  (t) => [index("mouvement_date_idx").on(t.date), index("mouvement_projet_idx").on(t.projetId), uniqueIndex("mouvement_cle_import_idx").on(t.cleImport)],
);

/**
 * Encaissement (ou décaissement) attendu d'un projet : honoraires (acompte, parts, solde), commission d'une
 * entreprise, commission d'apport. Datée par son jalon (date réelle, sinon prévue) ou par une date forcée.
 * prevue → facturee (n° et date de facture) → reglee (mouvement créé).
 */
export const echeance = sqliteTable(
  "echeance",
  {
    id: id(),
    projetId: text("projet_id")
      .notNull()
      .references(() => projet.id, { onDelete: "restrict" }),
    lotId: text("lot_id").references(() => lot.id, { onDelete: "restrict" }),
    /** Code dans l'échéancier : « acompte », « demarrage », « commission », « apport »… (unique par projet et lot). */
    code: text("code").notNull(),
    libelle: text("libelle").notNull(),
    sens: text("sens", { enum: ["entree", "sortie"] }).notNull(),
    payeurId: text("payeur_id").references(() => contact.id, { onDelete: "restrict" }),
    categorieId: text("categorie_id")
      .notNull()
      .references(() => categorie.id, { onDelete: "restrict" }),
    jalon: text("jalon").notNull(),
    /** Date forcée (remplace celle du jalon). */
    dateForcee: text("date_forcee"),
    ttc: integer("ttc").notNull(),
    ht: integer("ht").notNull(),
    statut: text("statut", { enum: ["prevue", "facturee", "reglee"] }).notNull().default("prevue"),
    numeroFacture: text("numero_facture"),
    dateFacture: text("date_facture"),
    mouvementId: text("mouvement_id"),
    archive: integer("archive", { mode: "boolean" }).notNull().default(false),
    ...tracabilite(),
  },
  (t) => [index("echeance_projet_idx").on(t.projetId)],
);

/** Dépense qui revient (loyer, LOA, salaire…) : alimente le prévu, et se rapproche des lignes du relevé. */
export const chargeRecurrente = sqliteTable("charge_recurrente", {
  id: id(),
  libelle: text("libelle").notNull(),
  tiers: text("tiers"),
  categorieId: text("categorie_id")
    .notNull()
    .references(() => categorie.id, { onDelete: "restrict" }),
  /** Montant TTC positif (centimes) ; c'est une dépense. */
  montantTtc: integer("montant_ttc").notNull(),
  tvaPb: integer("tva_pb").notNull().default(2000),
  periodicite: text("periodicite", { enum: ["mensuelle", "trimestrielle", "annuelle"] }).notNull().default("mensuelle"),
  /** Jour du mois du prélèvement (1 à 31 ; ramené au dernier jour des mois courts). */
  jour: integer("jour").notNull().default(1),
  debut: text("debut").notNull(),
  fin: text("fin"),
  /** Mot du libellé bancaire qui la reconnaît à l'import du relevé (« URSSAF »). */
  motCle: text("mot_cle"),
  archive: integer("archive", { mode: "boolean" }).notNull().default(false),
  ...tracabilite(),
});

export type Exercice = typeof exercice.$inferSelect;
export type Categorie = typeof categorie.$inferSelect;
export type Mouvement = typeof mouvement.$inferSelect;
export type Echeance = typeof echeance.$inferSelect;
export type ChargeRecurrente = typeof chargeRecurrente.$inferSelect;

// --- Suivi de chantier (phase 3, docs/rapport-de-visite.md)

/**
 * Visite de chantier et son rapport (cumulatif : le n° N reprend le n° N-1). Une visite peut couvrir plusieurs
 * dates. Envoyée : figée (on en crée une nouvelle).
 */
export const visite = sqliteTable(
  "visite",
  {
    id: id(),
    projetId: text("projet_id")
      .notNull()
      .references(() => projet.id, { onDelete: "restrict" }),
    numero: integer("numero").notNull(),
    /** Dates de la visite : JSON [« AAAA-MM-JJ »…]. */
    dates: text("dates").notNull(),
    sujetsAVenir: text("sujets_a_venir"),
    noteGenerale: text("note_generale"),
    statut: text("statut", { enum: ["brouillon", "envoyee"] }).notNull().default("brouillon"),
    envoyeeLe: text("envoyee_le"),
    archive: integer("archive", { mode: "boolean" }).notNull().default(false),
    creeLe: creeLe(),
    ...tracabilite(),
  },
  (t) => [index("visite_projet_idx").on(t.projetId)],
);

/** Intervenant d'une visite : présence (P/A/R/E), convoqué au prochain rendez-vous, destinataire du rapport. */
export const presence = sqliteTable(
  "presence",
  {
    id: id(),
    visiteId: text("visite_id")
      .notNull()
      .references(() => visite.id, { onDelete: "restrict" }),
    ordre: integer("ordre").notNull(),
    /** « Maître d'ouvrage », « AMO », « Lot n°01 : Maçonnerie ». */
    role: text("role").notNull(),
    contactId: text("contact_id").references(() => contact.id, { onDelete: "restrict" }),
    lotId: text("lot_id").references(() => lot.id, { onDelete: "restrict" }),
    representant: text("representant"),
    etat: text("etat", { enum: ["present", "absent", "retard", "excuse"] }),
    convoque: integer("convoque", { mode: "boolean" }).notNull().default(false),
    diffusion: integer("diffusion", { mode: "boolean" }).notNull().default(true),
    ...tracabilite(),
  },
  (t) => [index("presence_visite_idx").on(t.visiteId)],
);

/**
 * Point d'un lot dans une visite : avancement, suivi administratif et constats (repris de la visite précédente),
 * observations de la visite (une ligne commençant par « ! » est importante : en rouge dans le rapport).
 */
export const pointLot = sqliteTable(
  "point_lot",
  {
    id: id(),
    visiteId: text("visite_id")
      .notNull()
      .references(() => visite.id, { onDelete: "restrict" }),
    lotId: text("lot_id")
      .notNull()
      .references(() => lot.id, { onDelete: "restrict" }),
    avancement: integer("avancement"),
    suivi: text("suivi"),
    constats: text("constats"),
    observations: text("observations"),
    ...tracabilite(),
  },
  (t) => [index("point_lot_visite_idx").on(t.visiteId)],
);

/** Réserve (défaut à reprendre), par lot : constatée, puis levée (datée). */
export const reserve = sqliteTable(
  "reserve",
  {
    id: id(),
    projetId: text("projet_id")
      .notNull()
      .references(() => projet.id, { onDelete: "restrict" }),
    lotId: text("lot_id").references(() => lot.id, { onDelete: "restrict" }),
    visiteId: text("visite_id"),
    description: text("description").notNull(),
    constateeLe: text("constatee_le").notNull(),
    leveeLe: text("levee_le"),
    archive: integer("archive", { mode: "boolean" }).notNull().default(false),
    creeLe: creeLe(),
    ...tracabilite(),
  },
  (t) => [index("reserve_projet_idx").on(t.projetId)],
);

export type Visite = typeof visite.$inferSelect;
export type Presence = typeof presence.$inferSelect;
export type PointLot = typeof pointLot.$inferSelect;
export type Reserve = typeof reserve.$inferSelect;
