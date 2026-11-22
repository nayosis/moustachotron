/**
 * Les jalons datés d'un projet (conception § Statuts du projet, décidé le 22/11/2026) : le statut d'un projet est
 * son dernier jalon atteint (date réelle). Partagé par le serveur et l'interface.
 */

export type CodeJalon =
  | "reception_prospect"
  | "contact"
  | "visite_initiale"
  | "visite_2"
  | "estimation"
  | "validation_mission"
  | "signature_contrat"
  | "lancement_consultation"
  | "reception_devis"
  | "validation_devis"
  | "lancement_projet"
  | "demarrage_travaux"
  | "reception_travaux"
  | "reserves_levees"
  | "remise_rapport"
  | "clos";

/** Colonne du pipeline où se range un projet selon son dernier jalon. */
export type Colonne = "prospect" | "visite" | "mission" | "consultation" | "preparation" | "chantier" | "reception" | "clos";

export type DefJalon = {
  code: CodeJalon;
  libelle: string;
  colonne: Colonne;
  /** Seulement pour les missions avec travaux (true) ou sans travaux (false) ; absent : toutes. */
  travaux?: boolean;
  /** Peut être sauté sans gêner la suite (2e visite, réserves levées). */
  facultatif?: boolean;
};

export const JALONS: DefJalon[] = [
  { code: "reception_prospect", libelle: "Réception du prospect", colonne: "prospect" },
  { code: "contact", libelle: "Contact du prospect", colonne: "prospect" },
  { code: "visite_initiale", libelle: "Visite initiale", colonne: "visite" },
  { code: "visite_2", libelle: "2e visite", colonne: "visite", facultatif: true },
  { code: "estimation", libelle: "Remise de l'estimation", colonne: "visite" },
  { code: "validation_mission", libelle: "Validation de la mission", colonne: "mission" },
  { code: "signature_contrat", libelle: "Signature du contrat", colonne: "mission" },
  { code: "lancement_consultation", libelle: "Lancement de la consultation", colonne: "consultation", travaux: true },
  { code: "reception_devis", libelle: "Réception des devis", colonne: "consultation", travaux: true },
  { code: "validation_devis", libelle: "Validation des devis", colonne: "preparation", travaux: true },
  { code: "lancement_projet", libelle: "Lancement du projet (préparation)", colonne: "preparation", travaux: true },
  { code: "demarrage_travaux", libelle: "Démarrage des travaux", colonne: "chantier", travaux: true },
  { code: "reception_travaux", libelle: "Réception des travaux", colonne: "reception", travaux: true },
  { code: "reserves_levees", libelle: "Réserves levées", colonne: "reception", travaux: true, facultatif: true },
  { code: "remise_rapport", libelle: "Remise du rapport", colonne: "reception", travaux: false },
  { code: "clos", libelle: "Clos", colonne: "clos" },
];

export const COLONNES: { code: Colonne; libelle: string }[] = [
  { code: "prospect", libelle: "Prospect" },
  { code: "visite", libelle: "Visite & estimation" },
  { code: "mission", libelle: "Mission validée" },
  { code: "consultation", libelle: "Consultation" },
  { code: "preparation", libelle: "Préparation" },
  { code: "chantier", libelle: "Chantier" },
  { code: "reception", libelle: "Réception / rapport" },
  { code: "clos", libelle: "Clos" },
];

export const CODES_JALONS = new Set(JALONS.map((j) => j.code));

/** Jalons d'un projet selon que sa mission comporte des travaux. */
export const jalonsPour = (avecTravaux: boolean) => JALONS.filter((j) => j.travaux === undefined || j.travaux === avecTravaux);

export const libelleJalon = (code: string) => JALONS.find((j) => j.code === code)?.libelle ?? code;

/** Dernier jalon atteint (date réelle), dans l'ordre du cycle ; null si aucun. */
export function jalonCourant(avecTravaux: boolean, atteints: { code: string; dateReelle: string | null }[]): DefJalon | null {
  const faits = new Set(atteints.filter((a) => a.dateReelle).map((a) => a.code));
  let courant: DefJalon | null = null;
  for (const j of jalonsPour(avecTravaux)) if (faits.has(j.code)) courant = j;
  return courant;
}
