/** Extension (choisie par le serveur à l'envoi) → type MIME servi. */
export const MIME_PAR_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
};

/** Taille lisible : « 1,2 Mo ». */
export function tailleLisible(octets: number) {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 ** 2) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / 1024 ** 2).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

/**
 * Types de documents d'un projet (conception § Fichiers et documents, décidé le 22/11/2026).
 * `cible` : à quoi ils se rattachent d'habitude ; `validite` : avec une date de fin de validité (alerte).
 */
export const TYPES_DOCUMENTS: { code: string; libelle: string; cible: "projet" | "lot" | "entreprise" | "mouvement"; validite?: boolean }[] = [
  { code: "croquis", libelle: "Croquis", cible: "projet" },
  { code: "descriptif", libelle: "Descriptif des travaux", cible: "projet" },
  { code: "plans_avant", libelle: "Plans avant travaux", cible: "projet" },
  { code: "plans_travaux", libelle: "Plans travaux", cible: "projet" },
  { code: "devis", libelle: "Devis entreprise", cible: "lot" },
  { code: "devis_signe", libelle: "Devis signé", cible: "lot" },
  { code: "facture_entreprise", libelle: "Facture entreprise", cible: "lot" },
  { code: "facture_validee", libelle: "Facture validée", cible: "lot" },
  { code: "reglements_client", libelle: "Suivi des règlements client", cible: "projet" },
  { code: "attestation_assurance", libelle: "Attestation d'assurance", cible: "entreprise", validite: true },
  { code: "pv_reception", libelle: "PV de réception", cible: "projet" },
  { code: "photo", libelle: "Photo", cible: "projet" },
  { code: "facture_depense", libelle: "Facture (dépense)", cible: "mouvement" },
  { code: "autre", libelle: "Autre", cible: "projet" },
];

export const libelleTypeDocument = (code: string) => TYPES_DOCUMENTS.find((t) => t.code === code)?.libelle ?? code;
