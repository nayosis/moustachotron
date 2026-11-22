/*
 * Outils partagés par les fonctions de src/data/ (côté serveur uniquement).
 * Le « _ » du nom le retire du RPC : rien ici n'est appelable depuis le navigateur.
 */
import { existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { newId, query, type Statement } from "../db/client";
import { MIME_PAR_EXTENSION, TYPES_DOCUMENTS } from "../lib/documents";
import { BAREME_ACOMPTE_DEFAUT, type MissionPrix, type PalierAcompte } from "../lib/prix";
import { ErreurMetier } from "../../serveur/erreurs";
import { cheminFichier, nomValide } from "../../serveur/fichiers";

/** Fichier déjà envoyé (POST /api/fichiers), à rattacher à une fiche. */
export type FichierARattacher = { fichier: string; nom: string };

/** À quoi un document se rattache (au moins un des cinq). */
export type CibleDocument = { projetId?: string | null; lotId?: string | null; devisId?: string | null; contactId?: string | null; mouvementId?: string | null; visiteId?: string | null };

export const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Date facultative : vide → null, sinon « AAAA-MM-JJ » exigé. */
export function dateFacultative(d: string | null | undefined, libelle: string) {
  if (d == null || d === "") return null;
  if (!DATE.test(d)) throw new ErreurMetier(`${libelle} : date invalide.`);
  return d;
}

/** Texte obligatoire, nettoyé. */
export function texteObligatoire(t: string | null | undefined, libelle: string, max = 200) {
  const v = (t ?? "").trim();
  if (!v) throw new ErreurMetier(`${libelle} : obligatoire.`);
  if (v.length > max) throw new ErreurMetier(`${libelle} : trop long (${max} caractères au plus).`);
  return v;
}

/** Texte facultatif, nettoyé (vide → null). */
export const texteLibre = (t: string | null | undefined) => (t ?? "").trim() || null;

/** Montant en centimes : entier positif ou nul. */
export function montant(m: number | null | undefined, libelle: string, obligatoire = false) {
  if (m == null) {
    if (obligatoire) throw new ErreurMetier(`${libelle} : obligatoire.`);
    return null;
  }
  if (!Number.isInteger(m) || m < 0) throw new ErreurMetier(`${libelle} : montant invalide.`);
  return m;
}

/** Taux en points de base : entier entre 0 et 10 000. */
export function taux(pb: number | null | undefined, libelle: string) {
  if (pb == null) return null;
  if (!Number.isInteger(pb) || pb < 0 || pb > 10_000) throw new ErreurMetier(`${libelle} : taux invalide.`);
  return pb;
}

/** Ligne existante, sinon erreur 404 lisible. */
export async function exiger(table: string, id: string | null | undefined, libelle: string) {
  if (!id) throw new ErreurMetier(`${libelle} introuvable.`, 404);
  const [l] = await query(`select 1 from ${table} where id = ?`, [id]);
  if (!l) throw new ErreurMetier(`${libelle} introuvable.`, 404);
}

/** Valeur d'un paramètre (table `parametre`), lue en JSON ; `defaut` si absent ou illisible. */
export async function parametre<T>(cle: string, defaut: T): Promise<T> {
  const [l] = await query("select valeur from parametre where cle = ?", [cle]);
  if (!l) return defaut;
  try {
    return JSON.parse(String(l[0])) as T;
  } catch {
    return defaut;
  }
}

export const baremeAcompte = () => parametre<PalierAcompte[]>("bareme_acompte", BAREME_ACOMPTE_DEFAUT);

/** Règle de prix d'une mission (échéancier décodé). */
export async function missionPrix(code: string): Promise<MissionPrix & { code: string; libelle: string; avecTravaux: boolean }> {
  const [l] = await query("select code, libelle, mode, taux_pb, forfait_ttc, tva_pb, avec_travaux, avec_acompte, echeancier from mission where code = ?", [code]);
  if (!l) throw new ErreurMetier("Mission inconnue.");
  const [c, libelle, mode, tauxPb, forfaitTtc, tvaPb, avecTravaux, avecAcompte, ech] = l as [string, string, "forfait" | "pourcentage", number | null, number | null, number | null, number, number, string];
  return { code: c, libelle, mode, tauxPb, forfaitTtc, tvaPb, avecTravaux: !!avecTravaux, avecAcompte: !!avecAcompte, echeancier: JSON.parse(ech) };
}

/**
 * Instructions qui rattachent des fichiers envoyés à une cible : présents sur le disque, jamais rattachés.
 * Type et taille relus sur le disque (le navigateur ne les fixe pas).
 */
export async function instructionsDocuments(fichiers: FichierARattacher[], cible: CibleDocument, type: string, valideJusquAu?: string | null): Promise<Statement[]> {
  if (!TYPES_DOCUMENTS.some((t) => t.code === type)) throw new ErreurMetier("Type de document inconnu.");
  if (!cible.projetId && !cible.lotId && !cible.devisId && !cible.contactId && !cible.mouvementId && !cible.visiteId) throw new ErreurMetier("Document sans rattachement.");
  const validite = dateFacultative(valideJusquAu, "Fin de validité");
  const vus = new Set<string>();
  const sts: Statement[] = [];
  for (const f of fichiers) {
    if (!nomValide(f.fichier) || !existsSync(cheminFichier(f.fichier))) throw new ErreurMetier("Fichier introuvable : renvoyez-le.");
    const mime = MIME_PAR_EXTENSION[extname(f.fichier).slice(1)];
    if (!mime) throw new ErreurMetier("Type de fichier non pris en charge.");
    if (vus.has(f.fichier) || (await query("select 1 from document where fichier = ?", [f.fichier])).length) throw new ErreurMetier("Ce fichier est déjà rattaché.");
    vus.add(f.fichier);
    sts.push({
      sql: "insert into document (id, projet_id, lot_id, devis_id, contact_id, mouvement_id, visite_id, type, nom, fichier, mime, taille, valide_jusqu_au) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [newId(), cible.projetId ?? null, cible.lotId ?? null, cible.devisId ?? null, cible.contactId ?? null, cible.mouvementId ?? null, cible.visiteId ?? null, type, f.nom.trim() || f.fichier, f.fichier, mime, statSync(cheminFichier(f.fichier)).size, validite],
    });
  }
  return sts;
}
