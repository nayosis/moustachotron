/*
 * Contacts : clients (prospects tant qu'aucune mission n'est validée), entreprises, apporteurs, partenaires.
 * Conception § Vocabulaire et § Modèle. Archivés, jamais supprimés.
 */
import { and, asc, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { db, newId, query } from "../db/client";
import { contact, document, interaction, projet } from "../db/schema";
import { ErreurMetier } from "../../serveur/erreurs";
import { exiger, texteLibre, texteObligatoire } from "./_commun";
import { sansTrace, verifierVersion, versionDe } from "./_version";

export type TypeContact = (typeof contact.$inferSelect)["type"];
const TYPES_CONTACT: TypeContact[] = ["client", "entreprise", "apporteur", "partenaire", "autre"];
export type SaisieContact = {
  type: TypeContact;
  nom: string;
  interlocuteur?: string | null;
  corpsEtat?: string | null;
  telephone?: string | null;
  email?: string | null;
  adresse?: string | null;
  notes?: string | null;
};
export type FiltreContacts = { type?: TypeContact; recherche?: string; archives?: boolean };

/** Un client est « prospect » tant qu'aucun de ses projets n'a atteint la validation de la mission (engagement signé). */
const EST_PROSPECT = sql<number>`(case when "contact"."type" = 'client' and not exists (
  select 1 from jalon j join projet p on p.id = j.projet_id
  where p.client_id = "contact"."id" and j.date_reelle is not null and j.code in ('validation_mission', 'validation_devis', 'remise_rapport')
) then 1 else 0 end)`;

const NB_PROJETS = sql<number>`(select count(*) from projet p where p.client_id = "contact"."id" and p.archive = 0)`;

// --- Lecture

/** Contacts triés par nom, filtrables par type et par recherche (nom, interlocuteur, corps d'état, e-mail). */
export async function listeContacts(f: FiltreContacts = {}) {
  const conditions: SQL[] = [eq(contact.archive, !!f.archives)];
  if (f.type) conditions.push(eq(contact.type, f.type));
  const r = f.recherche?.trim();
  if (r) conditions.push(or(like(contact.nom, `%${r}%`), like(contact.interlocuteur, `%${r}%`), like(contact.corpsEtat, `%${r}%`), like(contact.email, `%${r}%`))!);
  const lignes = await db
    .select({
      id: contact.id,
      type: contact.type,
      nom: contact.nom,
      interlocuteur: contact.interlocuteur,
      corpsEtat: contact.corpsEtat,
      telephone: contact.telephone,
      email: contact.email,
      prospect: EST_PROSPECT,
      nbProjets: NB_PROJETS,
    })
    .from(contact)
    .where(and(...conditions))
    .orderBy(asc(contact.nom));
  return lignes.map((l) => ({ ...l, prospect: !!l.prospect }));
}

/** Un contact, ses projets (comme client ou apporteur), ses échanges et ses documents (attestations). */
export async function ficheContact(id: string) {
  const [c] = await db.select().from(contact).where(eq(contact.id, id));
  if (!c) throw new ErreurMetier("Contact introuvable.", 404);
  const [projets, interactions, documents, lots] = await Promise.all([
    db
      .select({ id: projet.id, reference: projet.reference, intitule: projet.intitule, missionCode: projet.missionCode, issue: projet.issue, apporteur: sql<number>`${projet.apporteurId} = ${id}` })
      .from(projet)
      .where(and(eq(projet.archive, false), or(eq(projet.clientId, id), eq(projet.apporteurId, id))))
      .orderBy(desc(projet.creeLe)),
    db.select().from(interaction).where(and(eq(interaction.contactId, id), eq(interaction.archive, false))).orderBy(desc(interaction.date), desc(interaction.creeLe)),
    db.select().from(document).where(eq(document.contactId, id)).orderBy(desc(document.creeLe)),
    // Entreprise : les lots qu'elle tient, avec leur projet.
    query(
      `select l.id, l.numero, l.corps_etat, p.id, p.reference, p.intitule from lot l join projet p on p.id = l.projet_id
       where l.entreprise_id = ? and l.archive = 0 and p.archive = 0 order by p.reference desc`,
      [id],
    ),
  ]);
  return {
    ...c,
    projets: projets.map((p) => ({ ...p, apporteur: !!p.apporteur })),
    interactions,
    documents,
    lots: lots.map(([lotId, numero, corpsEtat, projetId, reference, intitule]) => ({ lotId: String(lotId), numero: Number(numero), corpsEtat: String(corpsEtat), projetId: String(projetId), reference: String(reference), intitule: String(intitule) })),
  };
}

// --- Contrôles

function verifierSaisie(v: Partial<SaisieContact>) {
  if (v.type !== undefined && !TYPES_CONTACT.includes(v.type)) throw new ErreurMetier("Type de contact inconnu.");
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) throw new ErreurMetier("Adresse e-mail invalide.");
}

const colonnes = (v: Partial<SaisieContact>) => ({
  ...(v.type !== undefined ? { type: v.type } : {}),
  ...(v.nom !== undefined ? { nom: texteObligatoire(v.nom, "Nom") } : {}),
  ...(v.interlocuteur !== undefined ? { interlocuteur: texteLibre(v.interlocuteur) } : {}),
  ...(v.corpsEtat !== undefined ? { corpsEtat: texteLibre(v.corpsEtat) } : {}),
  ...(v.telephone !== undefined ? { telephone: texteLibre(v.telephone) } : {}),
  ...(v.email !== undefined ? { email: texteLibre(v.email) } : {}),
  ...(v.adresse !== undefined ? { adresse: texteLibre(v.adresse) } : {}),
  ...(v.notes !== undefined ? { notes: texteLibre(v.notes) } : {}),
});

// --- Écriture

/** Nouveau contact ; renvoie son identifiant. */
export async function creerContact(v: SaisieContact) {
  verifierSaisie(v);
  const id = newId();
  await db.insert(contact).values({ id, type: v.type, nom: texteObligatoire(v.nom, "Nom"), ...colonnes({ ...v, nom: undefined, type: undefined }) });
  return id;
}

/** Modifie un contact (version : `modifieLe` lu par le navigateur). */
export async function majContact(id: string, patch: Partial<SaisieContact>, version?: string | null) {
  await exiger("contact", id, "Contact");
  await verifierVersion("contact", id, version);
  const v = sansTrace(patch);
  verifierSaisie(v);
  const c = colonnes(v);
  if (Object.keys(c).length) await db.update(contact).set(c).where(eq(contact.id, id));
  return versionDe("contact", id);
}

/** Archive (ou ressort des archives) un contact. Un client avec un projet en cours ne s'archive pas. */
export async function archiverContact(id: string, archive: boolean) {
  await exiger("contact", id, "Contact");
  if (archive) {
    const [l] = await query("select count(*) from projet where client_id = ? and archive = 0 and issue = 'en_cours'", [id]);
    if (Number(l[0])) throw new ErreurMetier("Ce client a un projet en cours : archivez ou clôturez d'abord le projet.");
  }
  await query("update contact set archive = ? where id = ?", [archive ? 1 : 0, id]);
}
