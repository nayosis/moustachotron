/*
 * Visites de chantier et rapports (docs/rapport-de-visite.md) : rapport cumulatif (le n° N reprend le n° N-1),
 * présences, points par lot, photos, réserves. Un rapport envoyé est figé. Accès et urbanisme du chantier.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { batch, db, newId, query, type Statement } from "../db/client";
import { contact, document, lot, pointLot, presence, projet, reserve, visite } from "../db/schema";
import { ErreurMetier } from "../../serveur/erreurs";
import { aujourdhui } from "../lib/dates";
import { DATE, exiger, instructionsDocuments, parametre, texteLibre, texteObligatoire, type FichierARattacher } from "./_commun";

export type EtatPresence = "present" | "absent" | "retard" | "excuse";
export type Urbanisme = { depotDp?: string; acceptationDp?: string; affichage?: string; arreteDp?: string; docDeposee?: string; daactDeposee?: string; prescriptions?: string; planning?: string };
export type TextesRapport = Record<string, string>;

const ETATS: EtatPresence[] = ["present", "absent", "retard", "excuse"];

async function lireVisite(id: string) {
  const [v] = await db.select().from(visite).where(eq(visite.id, id));
  if (!v || v.archive) throw new ErreurMetier("Visite introuvable.", 404);
  return v;
}

async function verifierModifiable(visiteId: string) {
  const v = await lireVisite(visiteId);
  if (v.statut === "envoyee") throw new ErreurMetier("Ce rapport est envoyé : il n'est plus modifiable. Créez la visite suivante.");
  return v;
}

// --- Lecture

/** Visites d'un projet, de la plus récente à la plus ancienne. */
export async function listeVisites(projetId: string) {
  const l = await db.select().from(visite).where(and(eq(visite.projetId, projetId), eq(visite.archive, false))).orderBy(desc(visite.numero));
  return l.map((v) => ({ ...v, dates: JSON.parse(v.dates) as string[] }));
}

/** Une visite complète : projet, présences, points par lot (avec lot et entreprise), photos, réserves du projet. */
export async function ficheVisite(id: string) {
  const v = await lireVisite(id);
  const [[p], presences, points, photos, reserves, textes, signataire, agence, signature] = await Promise.all([
    db.select().from(projet).where(eq(projet.id, v.projetId)),
    db.select().from(presence).where(eq(presence.visiteId, id)).orderBy(asc(presence.ordre)),
    db
      .select({ point: pointLot, numero: lot.numero, corpsEtat: lot.corpsEtat, entrepriseNom: contact.nom })
      .from(pointLot)
      .innerJoin(lot, eq(lot.id, pointLot.lotId))
      .leftJoin(contact, eq(contact.id, lot.entrepriseId))
      .where(eq(pointLot.visiteId, id))
      .orderBy(asc(lot.numero)),
    db.select().from(document).where(and(eq(document.visiteId, id), eq(document.archive, false))).orderBy(asc(document.creeLe)),
    db.select().from(reserve).where(and(eq(reserve.projetId, v.projetId), eq(reserve.archive, false))).orderBy(asc(reserve.constateeLe)),
    parametre<TextesRapport>("textes_rapport", {}),
    parametre<string>("signataire_rapport", ""),
    parametre<string>("agence_rapport", ""),
    parametre<string>("signature_rapport", ""),
  ]);
  const [client] = await db.select().from(contact).where(eq(contact.id, p.clientId));
  return {
    ...v,
    dates: JSON.parse(v.dates) as string[],
    projet: { ...p, urbanisme: (p.urbanisme ? JSON.parse(p.urbanisme) : {}) as Urbanisme, clientNom: client?.nom ?? "" },
    presences,
    points: points.map((x) => ({ ...x.point, numero: x.numero, corpsEtat: x.corpsEtat, entrepriseNom: x.entrepriseNom })),
    photos,
    reserves,
    textes,
    signataire,
    agence,
    signature,
  };
}

// --- Écriture

/**
 * Nouvelle visite. Elle reprend la précédente (présences remises à zéro, convocations et destinataires gardés ;
 * avancement, suivi et constats repris ; observations vides) ; la première part des intervenants du projet.
 * `id` facultatif : fourni par l'appareil (saisie hors ligne, phase 3b) ; reçue deux fois = créée une fois.
 */
export async function creerVisite(projetId: string, date?: string | null, id?: string) {
  if (id) {
    const [deja] = await query("select 1 from visite where id = ?", [id]);
    if (deja) return id;
  }
  await exiger("projet", projetId, "Projet");
  const jour = date || aujourdhui();
  if (!DATE.test(jour)) throw new ErreurMetier("Date invalide.");
  const nouvelle = id ?? newId();
  const [precedente] = await db.select().from(visite).where(and(eq(visite.projetId, projetId), eq(visite.archive, false))).orderBy(desc(visite.numero)).limit(1);
  const lots = await db.select().from(lot).where(and(eq(lot.projetId, projetId), eq(lot.archive, false))).orderBy(asc(lot.numero));
  const sts: Statement[] = [
    {
      sql: "insert into visite (id, projet_id, numero, dates, sujets_a_venir) values (?, ?, ?, ?, ?)",
      params: [nouvelle, projetId, (precedente?.numero ?? 0) + 1, JSON.stringify([jour]), precedente?.sujetsAVenir ?? "Point sur travaux en cours et programmation des interventions à venir"],
    },
  ];
  // Présences : celles de la visite précédente (rôles, représentants, convocations), complétées des nouveaux lots.
  const anciennes = precedente ? await db.select().from(presence).where(eq(presence.visiteId, precedente.id)).orderBy(asc(presence.ordre)) : [];
  let ordre = 0;
  const ajouter = (role: string, contactId: string | null, lotId: string | null, representant: string | null, convoque = false, diffusion = true) =>
    sts.push({
      sql: "insert into presence (id, visite_id, ordre, role, contact_id, lot_id, representant, convoque, diffusion) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [newId(), nouvelle, ordre++, role, contactId, lotId, representant, convoque ? 1 : 0, diffusion ? 1 : 0],
    });
  if (anciennes.length) for (const a of anciennes) ajouter(a.role, a.contactId, a.lotId, a.representant, a.convoque, a.diffusion);
  else {
    const [p] = await db.select().from(projet).where(eq(projet.id, projetId));
    const [client] = await db.select().from(contact).where(eq(contact.id, p.clientId));
    ajouter("Maître d'ouvrage", client.id, null, client.interlocuteur ?? client.nom);
    ajouter(p.missionCode === "MOE" ? "Maître d'œuvre" : "AMO", null, null, (await parametre<string>("signataire_rapport", "")) || null);
  }
  for (const l of lots) {
    if (anciennes.some((a) => a.lotId === l.id)) continue;
    const [e] = l.entrepriseId ? await db.select().from(contact).where(eq(contact.id, l.entrepriseId)) : [];
    ajouter(`Lot n°${String(l.numero).padStart(2, "0")} : ${l.corpsEtat}`, e?.id ?? null, l.id, e?.interlocuteur ?? null, true);
  }
  // Points par lot : repris de la visite précédente (sans les observations), créés pour les nouveaux lots.
  const anciensPoints = precedente ? await db.select().from(pointLot).where(eq(pointLot.visiteId, precedente.id)) : [];
  for (const l of lots) {
    const a = anciensPoints.find((x) => x.lotId === l.id);
    sts.push({
      sql: "insert into point_lot (id, visite_id, lot_id, avancement, suivi, constats, observations) values (?, ?, ?, ?, ?, ?, null)",
      params: [newId(), nouvelle, l.id, a?.avancement ?? 0, a?.suivi ?? null, a?.constats ?? null],
    });
  }
  await batch(sts);
  return nouvelle;
}

/** Dates, sujets de la réunion à venir, note générale. */
export async function majVisite(id: string, v: { dates?: string[]; sujetsAVenir?: string | null; noteGenerale?: string | null }) {
  await verifierModifiable(id);
  if (v.dates !== undefined && (!v.dates.length || v.dates.some((d) => !DATE.test(d)))) throw new ErreurMetier("Dates de visite invalides (au moins une).");
  await db
    .update(visite)
    .set({
      ...(v.dates !== undefined ? { dates: JSON.stringify([...new Set(v.dates)].sort()) } : {}),
      ...(v.sujetsAVenir !== undefined ? { sujetsAVenir: texteLibre(v.sujetsAVenir) } : {}),
      ...(v.noteGenerale !== undefined ? { noteGenerale: texteLibre(v.noteGenerale) } : {}),
    })
    .where(eq(visite.id, id));
}

/** Présence d'un intervenant (état, représentant, convocation, diffusion). */
export async function majPresence(id: string, v: { etat?: EtatPresence | null; representant?: string | null; convoque?: boolean; diffusion?: boolean }) {
  const [l] = await query("select visite_id from presence where id = ?", [id]);
  if (!l) throw new ErreurMetier("Intervenant introuvable.", 404);
  await verifierModifiable(String(l[0]));
  if (v.etat != null && !ETATS.includes(v.etat)) throw new ErreurMetier("État de présence inconnu.");
  await db
    .update(presence)
    .set({
      ...(v.etat !== undefined ? { etat: v.etat } : {}),
      ...(v.representant !== undefined ? { representant: texteLibre(v.representant) } : {}),
      ...(v.convoque !== undefined ? { convoque: v.convoque } : {}),
      ...(v.diffusion !== undefined ? { diffusion: v.diffusion } : {}),
    })
    .where(eq(presence.id, id));
}

/** Point d'un lot : avancement (0 à 100), suivi, constats, observations (« ! » en tête de ligne = important). */
export async function majPointLot(id: string, v: { avancement?: number | null; suivi?: string | null; constats?: string | null; observations?: string | null }) {
  const [l] = await query("select visite_id from point_lot where id = ?", [id]);
  if (!l) throw new ErreurMetier("Point de lot introuvable.", 404);
  await verifierModifiable(String(l[0]));
  if (v.avancement != null && (!Number.isInteger(v.avancement) || v.avancement < 0 || v.avancement > 100)) throw new ErreurMetier("Avancement : entre 0 et 100 %.");
  await db
    .update(pointLot)
    .set({
      ...(v.avancement !== undefined ? { avancement: v.avancement } : {}),
      ...(v.suivi !== undefined ? { suivi: texteLibre(v.suivi) } : {}),
      ...(v.constats !== undefined ? { constats: texteLibre(v.constats) } : {}),
      ...(v.observations !== undefined ? { observations: texteLibre(v.observations) } : {}),
    })
    .where(eq(pointLot.id, id));
}

/** Photos d'une visite (et d'un lot, si donné). */
export async function ajouterPhotosVisite(visiteId: string, lotId: string | null, fichiers: FichierARattacher[]) {
  const v = await verifierModifiable(visiteId);
  if (lotId) {
    const [l] = await query("select 1 from lot where id = ? and projet_id = ?", [lotId, v.projetId]);
    if (!l) throw new ErreurMetier("Ce lot n'appartient pas au projet.");
  }
  const sts = await instructionsDocuments(fichiers, { projetId: v.projetId, lotId, visiteId }, "photo");
  if (sts.length) await batch(sts);
}

/** Rapport envoyé : figé, daté. (L'envoi lui-même se fait hors de l'application, avec le PDF.) */
export async function envoyerVisite(id: string) {
  await verifierModifiable(id);
  await db.update(visite).set({ statut: "envoyee", envoyeeLe: aujourdhui() }).where(eq(visite.id, id));
}

/** Retire une visite en brouillon saisie par erreur (archivée). */
export async function archiverVisite(id: string) {
  await verifierModifiable(id);
  await query("update visite set archive = 1 where id = ?", [id]);
}

// --- Réserves

/** Nouvelle réserve (lot facultatif), constatée aujourd'hui ou à la date donnée. */
export async function creerReserve(projetId: string, v: { lotId?: string | null; description: string; visiteId?: string | null; constateeLe?: string | null }) {
  await exiger("projet", projetId, "Projet");
  if (v.lotId) {
    const [l] = await query("select 1 from lot where id = ? and projet_id = ?", [v.lotId, projetId]);
    if (!l) throw new ErreurMetier("Ce lot n'appartient pas au projet.");
  }
  const date = v.constateeLe || aujourdhui();
  if (!DATE.test(date)) throw new ErreurMetier("Date invalide.");
  const id = newId();
  await db.insert(reserve).values({ id, projetId, lotId: v.lotId || null, visiteId: v.visiteId || null, description: texteObligatoire(v.description, "Réserve", 500), constateeLe: date });
  return id;
}

/** Lève une réserve (date), ou la rouvre (null). */
export async function leverReserve(id: string, date: string | null) {
  await exiger("reserve", id, "Réserve");
  if (date && !DATE.test(date)) throw new ErreurMetier("Date invalide.");
  await db.update(reserve).set({ leveeLe: date }).where(eq(reserve.id, id));
}

/** Retire une réserve saisie par erreur (archivée). */
export async function archiverReserve(id: string) {
  await exiger("reserve", id, "Réserve");
  await query("update reserve set archive = 1 where id = ?", [id]);
}

// --- Chantier : accès, urbanisme, textes et signature du rapport

/** Accès au chantier, n° de dossier et urbanisme (en-tête et formalités du rapport). */
export async function majChantier(projetId: string, v: { numeroDossier?: string | null; accesConditions?: string | null; accesStationnement?: string | null; accesStockage?: string | null; urbanisme?: Urbanisme }) {
  await exiger("projet", projetId, "Projet");
  await db
    .update(projet)
    .set({
      ...(v.numeroDossier !== undefined ? { numeroDossier: texteLibre(v.numeroDossier) } : {}),
      ...(v.accesConditions !== undefined ? { accesConditions: texteLibre(v.accesConditions) } : {}),
      ...(v.accesStationnement !== undefined ? { accesStationnement: texteLibre(v.accesStationnement) } : {}),
      ...(v.accesStockage !== undefined ? { accesStockage: texteLibre(v.accesStockage) } : {}),
      ...(v.urbanisme !== undefined ? { urbanisme: JSON.stringify(v.urbanisme) } : {}),
    })
    .where(eq(projet.id, projetId));
}

/** Textes types, signataire, agence et image de signature du rapport (réglages). */
export async function majReglagesRapport(v: { textes?: TextesRapport; signataire?: string; agence?: string; signature?: string | null }) {
  const sts: Statement[] = [];
  const ecrire = (cle: string, valeur: unknown) =>
    sts.push({ sql: "insert into parametre (cle, valeur) values (?, ?) on conflict (cle) do update set valeur = excluded.valeur", params: [cle, JSON.stringify(valeur)] });
  if (v.textes !== undefined) ecrire("textes_rapport", v.textes);
  if (v.signataire !== undefined) ecrire("signataire_rapport", v.signataire.trim());
  if (v.agence !== undefined) ecrire("agence_rapport", v.agence.trim());
  if (v.signature !== undefined) ecrire("signature_rapport", v.signature ?? "");
  if (sts.length) await batch(sts);
}

/** Réglages du rapport (lecture). */
export async function reglagesRapport() {
  return {
    textes: await parametre<TextesRapport>("textes_rapport", {}),
    signataire: await parametre<string>("signataire_rapport", ""),
    agence: await parametre<string>("agence_rapport", ""),
    signature: await parametre<string>("signature_rapport", ""),
  };
}
