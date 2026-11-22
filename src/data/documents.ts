/*
 * Documents d'un projet, d'un lot ou d'une entreprise (conception § Fichiers et documents) : jamais effacés, retirés
 * = archivés. Les attestations d'assurance ont une fin de validité et déclenchent une alerte avant échéance.
 */
import { batch, query } from "../db/client";
import { ErreurMetier } from "../../serveur/erreurs";
import { aujourdhui } from "../lib/dates";
import { exiger, instructionsDocuments, parametre, type CibleDocument, type FichierARattacher } from "./_commun";

export type { FichierARattacher, CibleDocument } from "./_commun";

/** Rattache des fichiers envoyés à un projet, un lot (et son projet) ou une entreprise. */
export async function ajouterDocuments(cible: CibleDocument, type: string, fichiers: FichierARattacher[], valideJusquAu?: string | null) {
  if (!fichiers.length) return;
  const c = { ...cible };
  if (c.projetId) await exiger("projet", c.projetId, "Projet");
  if (c.contactId) await exiger("contact", c.contactId, "Contact");
  if (c.lotId) {
    const [l] = await query("select projet_id from lot where id = ?", [c.lotId]);
    if (!l) throw new ErreurMetier("Lot introuvable.", 404);
    if (c.projetId && c.projetId !== l[0]) throw new ErreurMetier("Ce lot n'appartient pas à ce projet.");
    c.projetId = String(l[0]);
  }
  if (type === "attestation_assurance" && !c.contactId) throw new ErreurMetier("Une attestation d'assurance se rattache à une entreprise.");
  if (type === "attestation_assurance" && !valideJusquAu) throw new ErreurMetier("Attestation d'assurance : indiquez sa fin de validité.");
  await batch(await instructionsDocuments(fichiers, c, type, valideJusquAu));
}

/** Retire un document : archivé (le fichier reste, consultable depuis le journal). */
export async function retirerDocument(id: string) {
  await exiger("document", id, "Document");
  await query("update document set archive = 1 where id = ?", [id]);
}

/**
 * Entreprises dont la dernière attestation d'assurance expire dans moins de N jours (réglage
 * `alerte_assurance_jours`, 30 par défaut) ou est expirée, avec le nombre de projets en cours où elles tiennent un lot.
 */
export async function attestationsAEcheance() {
  const jours = await parametre<number>("alerte_assurance_jours", 30);
  const d = new Date(`${aujourdhui()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  const limite = d.toISOString().slice(0, 10);
  const lignes = await query(
    `select c.id, c.nom, max(doc.valide_jusqu_au) as fin,
            (select count(distinct l.projet_id) from lot l join projet p on p.id = l.projet_id
              where l.entreprise_id = c.id and l.archive = 0 and p.archive = 0 and p.issue = 'en_cours') as projets
     from contact c join document doc on doc.contact_id = c.id
     where c.archive = 0 and doc.archive = 0 and doc.type = 'attestation_assurance' and doc.valide_jusqu_au is not null
     group by c.id having fin <= ? order by fin`,
    [limite],
  );
  const aujd = aujourdhui();
  return lignes.map(([id, nom, fin, projets]) => ({ id: String(id), nom: String(nom), fin: String(fin), expiree: String(fin) < aujd, projets: Number(projets) }));
}
