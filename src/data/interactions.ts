/*
 * Échanges avec les contacts (appel, e-mail, rendez-vous, visite, note) et relances : une interaction avec une
 * date « à faire le » non faite est une relance (conception § Avant-vente et relances).
 */
import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { db, newId, query } from "../db/client";
import { contact, interaction, projet } from "../db/schema";
import { ErreurMetier } from "../../serveur/erreurs";
import { aujourdhui } from "../lib/dates";
import { DATE, dateFacultative, exiger, parametre, texteLibre, texteObligatoire } from "./_commun";
import { sansTrace, verifierVersion, versionDe } from "./_version";

export type NatureInteraction = (typeof interaction.$inferSelect)["nature"];
const NATURES: NatureInteraction[] = ["appel", "email", "rdv", "visite", "sms", "note"];
export type SaisieInteraction = {
  contactId: string;
  projetId?: string | null;
  nature: NatureInteraction;
  date: string;
  heure?: string | null;
  objet: string;
  texte?: string | null;
  aFaireLe?: string | null;
};

// --- Lecture

/** Relances à faire jusqu'à une date (aujourd'hui par défaut), les plus anciennes d'abord, avec contact et projet. */
export async function listeRelances(jusquAu?: string) {
  const fin = jusquAu ?? aujourdhui();
  return db
    .select({
      id: interaction.id,
      aFaireLe: interaction.aFaireLe,
      objet: interaction.objet,
      nature: interaction.nature,
      contactId: contact.id,
      contactNom: contact.nom,
      projetId: projet.id,
      projetReference: projet.reference,
      modifieLe: interaction.modifieLe,
    })
    .from(interaction)
    .innerJoin(contact, eq(contact.id, interaction.contactId))
    .leftJoin(projet, eq(projet.id, interaction.projetId))
    .where(and(eq(interaction.archive, false), eq(interaction.faite, false), isNotNull(interaction.aFaireLe), lte(interaction.aFaireLe, fin)))
    .orderBy(asc(interaction.aFaireLe));
}

/**
 * Projets en attente de réponse du client (estimation remise, mission pas encore validée) sans échange depuis N jours
 * (réglage `relance_jours`, 15 par défaut) et sans relance déjà prévue : à relancer. La dernière nouvelle est la
 * remise de l'estimation ou un échange plus récent (pas les jalons antérieurs, comme la réception du prospect).
 */
export async function projetsSansNouvelles() {
  const jours = await parametre<number>("relance_jours", 15);
  const lignes = await query(
    `select p.id, p.reference, p.intitule, c.id, c.nom,
            max(coalesce((select max(i.date) from interaction i where i.projet_id = p.id and i.archive = 0), ''),
                (select j.date_reelle from jalon j where j.projet_id = p.id and j.code = 'estimation')) as dernier
     from projet p join contact c on c.id = p.client_id
     where p.archive = 0 and p.issue = 'en_cours'
       and exists (select 1 from jalon j where j.projet_id = p.id and j.code = 'estimation' and j.date_reelle is not null)
       and not exists (select 1 from jalon j where j.projet_id = p.id and j.code = 'validation_mission' and j.date_reelle is not null)
       and not exists (select 1 from interaction i where i.projet_id = p.id and i.archive = 0 and i.faite = 0 and i.a_faire_le is not null)`,
  );
  const limite = new Date(`${aujourdhui()}T12:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() - jours);
  const borne = limite.toISOString().slice(0, 10);
  return lignes
    .map(([id, reference, intitule, contactId, contactNom, dernier]) => ({ id: String(id), reference: String(reference), intitule: String(intitule), contactId: String(contactId), contactNom: String(contactNom), dernier: String(dernier) }))
    .filter((p) => p.dernier && p.dernier <= borne);
}

// --- Contrôles

async function verifierSaisie(v: Partial<SaisieInteraction>) {
  if (v.nature !== undefined && !NATURES.includes(v.nature)) throw new ErreurMetier("Nature d'échange inconnue.");
  if (v.date !== undefined && !DATE.test(v.date)) throw new ErreurMetier("Date invalide.");
  if (v.heure && !/^\d{2}:\d{2}$/.test(v.heure)) throw new ErreurMetier("Heure invalide (hh:mm).");
  if (v.contactId !== undefined) await exiger("contact", v.contactId, "Contact");
  if (v.projetId) {
    await exiger("projet", v.projetId, "Projet");
    // Le contact doit être lié au projet (client, apporteur ou entreprise d'un lot) : évite les rattachements par erreur.
    if (v.contactId) {
      const [l] = await query(
        "select 1 from projet p where p.id = ? and (p.client_id = ? or p.apporteur_id = ? or exists (select 1 from lot l where l.projet_id = p.id and l.entreprise_id = ?))",
        [v.projetId, v.contactId, v.contactId, v.contactId],
      );
      if (!l) throw new ErreurMetier("Ce contact n'intervient pas sur ce projet.");
    }
  }
}

// --- Écriture

/**
 * Nouvel échange (ou relance). `id` facultatif : fourni par l'appareil pour une saisie hors ligne (phase 3) ;
 * une même saisie reçue deux fois n'est enregistrée qu'une fois.
 */
export async function creerInteraction(v: SaisieInteraction, id?: string) {
  if (id) {
    const [deja] = await query("select 1 from interaction where id = ?", [id]);
    if (deja) return id;
  }
  await verifierSaisie(v);
  const nouvel = id ?? newId();
  await db.insert(interaction).values({
    id: nouvel,
    contactId: v.contactId,
    projetId: v.projetId || null,
    nature: v.nature,
    date: v.date,
    heure: texteLibre(v.heure),
    objet: texteObligatoire(v.objet, "Objet"),
    texte: texteLibre(v.texte),
    aFaireLe: dateFacultative(v.aFaireLe, "À faire le"),
  });
  return nouvel;
}

/** Modifie un échange. */
export async function majInteraction(id: string, patch: Partial<Omit<SaisieInteraction, "contactId">>, version?: string | null) {
  await exiger("interaction", id, "Échange");
  await verifierVersion("interaction", id, version);
  const v = sansTrace(patch);
  const [l] = await query("select contact_id from interaction where id = ?", [id]);
  await verifierSaisie({ ...v, contactId: String(l[0]) });
  await db
    .update(interaction)
    .set({
      ...(v.projetId !== undefined ? { projetId: v.projetId || null } : {}),
      ...(v.nature !== undefined ? { nature: v.nature } : {}),
      ...(v.date !== undefined ? { date: v.date } : {}),
      ...(v.heure !== undefined ? { heure: texteLibre(v.heure) } : {}),
      ...(v.objet !== undefined ? { objet: texteObligatoire(v.objet, "Objet") } : {}),
      ...(v.texte !== undefined ? { texte: texteLibre(v.texte) } : {}),
      ...(v.aFaireLe !== undefined ? { aFaireLe: dateFacultative(v.aFaireLe, "À faire le") } : {}),
    })
    .where(eq(interaction.id, id));
  return versionDe("interaction", id);
}

/** Relance faite (ou refaite à faire). */
export async function marquerFaite(id: string, faite: boolean) {
  await exiger("interaction", id, "Échange");
  await db.update(interaction).set({ faite }).where(eq(interaction.id, id));
}

/** Reporte une relance à une autre date. */
export async function reporterRelance(id: string, aFaireLe: string) {
  await exiger("interaction", id, "Échange");
  if (!DATE.test(aFaireLe)) throw new ErreurMetier("Date invalide.");
  await db.update(interaction).set({ aFaireLe, faite: false }).where(eq(interaction.id, id));
}

/** Retire un échange saisi par erreur : archivé (reste dans le journal). */
export async function archiverInteraction(id: string) {
  await exiger("interaction", id, "Échange");
  await query("update interaction set archive = 1 where id = ?", [id]);
}

