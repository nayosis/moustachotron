/*
 * Ce que le socle doit savoir du modèle de l'application : SEUL fichier du serveur à adapter quand on ajoute
 * une table ou une fonction métier (avec src/db/schema.ts, src/data/ et src/lib/modele.ts côté interface).
 *
 * Le reste de serveur/ (comptes, journal, traçabilité, sauvegardes, événements) est générique.
 */
import type { Database } from "bun:sqlite";

/** Fonctions de src/data/ qui ne modifient rien. Toute autre fonction exposée est une écriture (sûr par défaut). */
export const LECTURES = [
  "listeContacts",
  "ficheContact",
  "listeRelances",
  "projetsSansNouvelles",
  "referentiels",
  "listeProjets",
  "ficheProjet",
  "lotsDuProjet",
  "attestationsAEcheance",
  "tableauDeBord",
  "apercuEcheances",
  "referentielTresorerie",
  "vueTresorerie",
  "syntheseExercice",
  "listeMouvements",
  "listeChargesRecurrentes",
  "analyserReleve",
  "listeVisites",
  "ficheVisite",
  "reglagesRapport",
];

/**
 * Tables métier suivies : colonnes cree_par / modifie_par / modifie_le remplies par déclencheurs, instantanés du journal.
 * Toutes ont une clé `id` (le journal retrouve une fiche par son id) : les référentiels `mission` et `origine`, à clé
 * `code`, n'y sont pas (ils changeront depuis les Paramètres, avec leur propre journalisation).
 */
export const TABLES_SUIVIES = ["contact", "interaction", "projet", "jalon", "lot", "devis", "document", "exercice", "categorie", "mouvement", "echeance", "charge_recurrente", "visite", "presence", "point_lot", "reserve"];

/** Tables qu'une sauvegarde doit contenir pour être restaurée ici (vérifie qu'elle vient bien de cette application). */
export const TABLES_ATTENDUES = [...TABLES_SUIVIES, "mission", "origine", "parametre", "journal", "__migrations"];

/** Compteurs affichés à la sauvegarde et gardés dans son manifeste (libellé → requête qui renvoie un nombre). */
export const COMPTEURS: Record<string, string> = {
  Contacts: "select count(*) from contact",
  Projets: "select count(*) from projet",
  Lots: "select count(*) from lot",
  Devis: "select count(*) from devis",
  Échanges: "select count(*) from interaction",
  Documents: "select count(*) from document",
  Mouvements: "select count(*) from mouvement",
  Échéances: "select count(*) from echeance",
  Visites: "select count(*) from visite",
};

/**
 * Fichiers rattachés (data/fichiers/) : tout autre fichier est un orphelin, effacé au bout de 7 jours. L'image de
 * signature du rapport de visite (réglage) en fait partie.
 */
export const REQUETE_FICHIERS_CITES = "select fichier from document union select json_extract(valeur, '$') from parametre where cle = 'signature_rapport'";

/**
 * Colonnes de lien vers une fiche parente : le journal d'une fiche montre aussi les écritures des lignes qui la
 * citent (l'historique d'un projet inclut ses lots, jalons, échanges et documents).
 */
export const LIENS_JOURNAL = ["projet_id", "lot_id", "contact_id", "client_id", "visite_id"];

/**
 * Complète l'instantané d'une fiche (journal, avant / après) de ce qui la décrit vraiment : ses liens, ses fichiers.
 * Une preuve doit se lire seule, sans la base d'origine.
 */
export function enrichir(base: Database, table: string, ligne: Record<string, unknown>) {
  const id = String(ligne.id);
  if (table === "projet") {
    ligne.jalons = base.query("SELECT code, date_prevue, date_reelle FROM jalon WHERE projet_id = ? ORDER BY code").all(id);
    ligne.lots = base.query("SELECT id, numero, corps_etat, entreprise_id, tva_pb, commission_pb, montant_ttc, archive FROM lot WHERE projet_id = ? ORDER BY numero").all(id);
    ligne.documents = base.query("SELECT id, type, nom, fichier, archive FROM document WHERE projet_id = ? ORDER BY cree_le").all(id);
    ligne.echeances = base.query("SELECT code, lot_id, libelle, ttc, ht, statut, numero_facture, archive FROM echeance WHERE projet_id = ? ORDER BY code").all(id);
  }
  if (table === "visite") {
    ligne.presences = base.query("SELECT role, representant, etat, convoque, diffusion FROM presence WHERE visite_id = ? ORDER BY ordre").all(id);
    ligne.points = base.query("SELECT lot_id, avancement, suivi, constats, observations FROM point_lot WHERE visite_id = ?").all(id);
    ligne.documents = base.query("SELECT id, type, nom, fichier, archive FROM document WHERE visite_id = ? ORDER BY cree_le").all(id);
  }
  if (table === "mouvement") {
    ligne.documents = base.query("SELECT id, type, nom, fichier, archive FROM document WHERE mouvement_id = ? ORDER BY cree_le").all(id);
  }
  if (table === "lot") {
    ligne.devis = base.query("SELECT id, entreprise_id, reference, version, date, montant_ttc, statut, archive FROM devis WHERE lot_id = ? ORDER BY date").all(id);
  }
  if (table === "contact") {
    ligne.documents = base.query("SELECT id, type, nom, fichier, valide_jusqu_au, archive FROM document WHERE contact_id = ? ORDER BY cree_le").all(id);
  }
}
