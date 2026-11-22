/*
 * Projets : de la réception du prospect à la réception des travaux (conception § Statuts du projet, § Montants).
 * Le statut est le dernier jalon atteint ; une validation partielle des devis crée un projet « tranche 2 » lié.
 */
import { and, asc, desc, eq, inArray, like, or, type SQL } from "drizzle-orm";
import { batch, db, newId, query, type Statement } from "../db/client";
import { contact, document, interaction, jalon, lot, mission, origine, projet } from "../db/schema";
import { ErreurMetier } from "../../serveur/erreurs";
import { aujourdhui } from "../lib/dates";
import { CODES_JALONS, JALONS, jalonCourant, jalonsPour, type CodeJalon } from "../lib/jalons";
import { syntheseProjet } from "../lib/prix";
import { baremeAcompte, dateFacultative, exiger, missionPrix, montant, parametre, taux, texteLibre, texteObligatoire } from "./_commun";
import { sansTrace, verifierVersion, versionDe } from "./_version";
import { creerContact, type SaisieContact } from "./contacts";
import { aDesEcheances, planifier } from "./_echeances";

export type SaisieProjet = {
  intitule: string;
  missionCode: string;
  origineCode: string;
  apporteurId?: string | null;
  adresse?: string | null;
  estimationTtc?: number | null;
  tauxPb?: number | null;
  forfaitTtc?: number | null;
  tauxApportPb?: number | null;
  notes?: string | null;
};
export type NouveauProjet = Omit<SaisieProjet, "tauxPb" | "forfaitTtc" | "tauxApportPb"> & {
  clientId?: string | null;
  /** Client créé en même temps (prospect qui appelle pour la première fois). */
  nouveauClient?: Omit<SaisieContact, "type"> | null;
  /** Date de réception du prospect (aujourd'hui par défaut). */
  recuLe?: string | null;
};
export type FiltreProjets = { recherche?: string; issue?: "en_cours" | "perdu" | "abandonne" | "tous"; archives?: boolean };

/** Jalons qui ne se saisissent pas directement : ils passent par une fonction dédiée (règles). */
const JALONS_DEDIES: CodeJalon[] = ["validation_devis"];

// --- Lecture

/** Missions et origines (listes des formulaires), avec les réglages utiles à l'interface. */
export async function referentiels() {
  const [missions, origines, bareme, commissionDefautPb, apportDefautPb] = await Promise.all([
    db.select().from(mission).orderBy(asc(mission.ordre)),
    db.select().from(origine).orderBy(asc(origine.ordre)),
    baremeAcompte(),
    parametre<number>("commission_defaut_pb", 1300),
    parametre<number>("apport_defaut_pb", 1000),
  ]);
  return { missions: missions.map((m) => ({ ...m, echeancier: JSON.parse(m.echeancier) })), origines, bareme, commissionDefautPb, apportDefautPb };
}

/** Lots (non archivés) des projets donnés, groupés par projet. */
async function lotsDe(ids: string[]) {
  if (!ids.length) return new Map<string, (typeof lot.$inferSelect)[]>();
  const lignes = await db.select().from(lot).where(and(inArray(lot.projetId, ids), eq(lot.archive, false))).orderBy(asc(lot.numero));
  const m = new Map<string, (typeof lot.$inferSelect)[]>();
  for (const l of lignes) m.set(l.projetId, [...(m.get(l.projetId) ?? []), l]);
  return m;
}

/**
 * Projets avec client, mission, jalon courant, prochain jalon prévu, montants et prochaine relance.
 * Sert la liste et le pipeline (regroupé par colonne côté interface).
 */
export async function listeProjets(f: FiltreProjets = {}) {
  const conditions: SQL[] = [eq(projet.archive, !!f.archives)];
  const issue = f.issue ?? "en_cours";
  if (issue !== "tous") conditions.push(eq(projet.issue, issue));
  const r = f.recherche?.trim();
  if (r) conditions.push(or(like(projet.intitule, `%${r}%`), like(projet.reference, `%${r}%`), like(contact.nom, `%${r}%`), like(projet.adresse, `%${r}%`))!);
  const projets = await db
    .select({
      id: projet.id,
      reference: projet.reference,
      intitule: projet.intitule,
      issue: projet.issue,
      missionCode: projet.missionCode,
      tauxPb: projet.tauxPb,
      forfaitTtc: projet.forfaitTtc,
      tauxApportPb: projet.tauxApportPb,
      estimationTtc: projet.estimationTtc,
      projetOrigineId: projet.projetOrigineId,
      clientId: contact.id,
      clientNom: contact.nom,
    })
    .from(projet)
    .innerJoin(contact, eq(contact.id, projet.clientId))
    .where(and(...conditions))
    .orderBy(desc(projet.reference));
  const ids = projets.map((p) => p.id);
  const [jalons, lots, relances, missions, bareme] = await Promise.all([
    ids.length ? db.select().from(jalon).where(inArray(jalon.projetId, ids)) : Promise.resolve([]),
    lotsDe(ids),
    ids.length
      ? db
          .select({ projetId: interaction.projetId, aFaireLe: interaction.aFaireLe })
          .from(interaction)
          .where(and(inArray(interaction.projetId, ids), eq(interaction.faite, false), eq(interaction.archive, false)))
      : Promise.resolve([]),
    referentiels().then((r) => new Map(r.missions.map((m) => [m.code, m]))),
    baremeAcompte(),
  ]);
  const aujd = aujourdhui();
  return projets.map((p) => {
    const m = missions.get(p.missionCode)!;
    const js = jalons.filter((j) => j.projetId === p.id);
    const courant = jalonCourant(m.avecTravaux, js);
    // Prochain jalon prévu : après le jalon courant (un jalon sauté, comme une réception des devis jamais datée,
    // ne doit plus s'annoncer une fois le projet passé au-delà).
    const ordre = jalonsPour(m.avecTravaux);
    const apres = courant ? ordre.findIndex((d) => d.code === courant.code) + 1 : 0;
    const prochain = ordre
      .slice(apres)
      .map((d) => ({ ...d, datePrevue: js.find((j) => j.code === d.code)?.datePrevue ?? null }))
      .find((d) => d.datePrevue);
    const relance = relances
      .filter((x) => x.projetId === p.id && x.aFaireLe)
      .map((x) => x.aFaireLe!)
      .sort()[0];
    const s = syntheseProjet(m, p, lots.get(p.id) ?? [], bareme);
    return {
      ...p,
      missionLibelle: m.libelle,
      jalon: courant ? { code: courant.code, libelle: courant.libelle, colonne: courant.colonne, date: js.find((j) => j.code === courant.code)?.dateReelle ?? null } : null,
      prochain: prochain ? { code: prochain.code, libelle: prochain.libelle, date: prochain.datePrevue, enRetard: prochain.datePrevue! < aujd } : null,
      relance: relance ?? null,
      nbLots: (lots.get(p.id) ?? []).length,
      travauxTtc: s.travauxTtc,
      honorairesTtc: s.honorairesTtc,
      honorairesHt: s.honorairesHt,
      commissionsHt: s.commissionsHt,
    };
  });
}

/** Un projet complet : client, apporteur, mission, jalons, lots et devis, documents, échanges, tranches, montants. */
export async function ficheProjet(id: string) {
  const [p] = await db.select().from(projet).where(eq(projet.id, id));
  if (!p) throw new ErreurMetier("Projet introuvable.", 404);
  const m = await missionPrix(p.missionCode);
  const [client, apporteur, jalons, lots, lesDevis, documents, interactions, tranches, bareme, [o]] = await Promise.all([
    db.select().from(contact).where(eq(contact.id, p.clientId)).then((r) => r[0]),
    p.apporteurId ? db.select().from(contact).where(eq(contact.id, p.apporteurId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    db.select().from(jalon).where(eq(jalon.projetId, id)),
    db
      .select({ lot, entrepriseNom: contact.nom })
      .from(lot)
      .leftJoin(contact, eq(contact.id, lot.entrepriseId))
      .where(eq(lot.projetId, id))
      .orderBy(asc(lot.numero)),
    query(
      `select d.id, d.lot_id, d.entreprise_id, c.nom, d.reference, d.version, d.date, d.montant_ttc, d.statut, d.archive, d.modifie_le
       from devis d join lot l on l.id = d.lot_id join contact c on c.id = d.entreprise_id where l.projet_id = ? order by d.date, d.version`,
      [id],
    ),
    db.select().from(document).where(eq(document.projetId, id)).orderBy(desc(document.creeLe)),
    db
      .select({ i: interaction, contactNom: contact.nom })
      .from(interaction)
      .innerJoin(contact, eq(contact.id, interaction.contactId))
      .where(and(eq(interaction.projetId, id), eq(interaction.archive, false)))
      .orderBy(desc(interaction.date), desc(interaction.creeLe)),
    db
      .select({ id: projet.id, reference: projet.reference, intitule: projet.intitule, projetOrigineId: projet.projetOrigineId })
      .from(projet)
      .where(or(eq(projet.projetOrigineId, id), p.projetOrigineId ? eq(projet.id, p.projetOrigineId) : eq(projet.id, "")))
      .orderBy(asc(projet.reference)),
    baremeAcompte(),
    db.select().from(origine).where(eq(origine.code, p.origineCode)),
  ]);
  const devisDe = lesDevis.map(([did, lotId, entrepriseId, entrepriseNom, reference, version, date, montantTtc, statut, archive, modifieLe]) => ({
    id: String(did),
    lotId: String(lotId),
    entrepriseId: String(entrepriseId),
    entrepriseNom: String(entrepriseNom),
    reference: (reference as string | null) ?? null,
    version: Number(version),
    date: String(date),
    montantTtc: Number(montantTtc),
    statut: statut as "recu" | "retenu" | "refuse",
    archive: !!archive,
    modifieLe: (modifieLe as string | null) ?? null,
  }));
  const lotsActifs = lots.filter((l) => !l.lot.archive).map((l) => l.lot);
  const s = syntheseProjet(m, p, lotsActifs, bareme);
  const courant = jalonCourant(m.avecTravaux, jalons);
  return {
    ...p,
    client,
    apporteur,
    origineLibelle: o?.libelle ?? p.origineCode,
    mission: m,
    jalon: courant,
    jalons: jalonsPour(m.avecTravaux).map((d) => {
      const j = jalons.find((x) => x.code === d.code);
      return { ...d, datePrevue: j?.datePrevue ?? null, dateReelle: j?.dateReelle ?? null };
    }),
    lots: lots.map((l) => ({ ...l.lot, entrepriseNom: l.entrepriseNom, devis: devisDe.filter((d) => d.lotId === l.lot.id) })),
    documents,
    interactions: interactions.map((x) => ({ ...x.i, contactNom: x.contactNom })),
    trancheOrigine: tranches.find((t) => t.id === p.projetOrigineId) ?? null,
    tranchesSuivantes: tranches.filter((t) => t.projetOrigineId === id),
    synthese: s,
    devisValides: jalons.some((j) => j.code === "validation_devis" && j.dateReelle),
    echeances: await echeancesDuProjet(id),
  };
}

/** Échéances en base d'un projet, datées par leur jalon (date réelle, sinon prévue) ou leur date forcée. */
async function echeancesDuProjet(id: string) {
  const l = await query(
    `select e.id, e.code, e.lot_id, e.libelle, e.sens, e.ttc, e.ht, e.statut, e.numero_facture, e.date_facture, e.jalon, e.date_forcee,
            coalesce(e.date_forcee, j.date_reelle, j.date_prevue), m.date, c.nom
     from echeance e left join jalon j on j.projet_id = e.projet_id and j.code = e.jalon
     left join mouvement m on m.id = e.mouvement_id left join contact c on c.id = e.payeur_id
     where e.projet_id = ? and e.archive = 0`,
    [id],
  );
  const ordre = (code: string) => ["acompte", "commande", "signature_devis", "demarrage", "commission", "solde", "apport"].indexOf(code);
  return l
    .map(([eid, code, lotId, libelle, sens, ttc, ht, statut, numeroFacture, dateFacture, jalonCode, dateForcee, date, dateReglement, payeurNom]) => ({
      id: String(eid),
      code: String(code),
      lotId: (lotId as string | null) ?? null,
      libelle: String(libelle),
      sens: sens as "entree" | "sortie",
      ttc: Number(ttc),
      ht: Number(ht),
      statut: statut as "prevue" | "facturee" | "reglee",
      numeroFacture: (numeroFacture as string | null) ?? null,
      dateFacture: (dateFacture as string | null) ?? null,
      jalon: String(jalonCode),
      dateForcee: (dateForcee as string | null) ?? null,
      date: (date as string | null) ?? null,
      dateReglement: (dateReglement as string | null) ?? null,
      payeurNom: (payeurNom as string | null) ?? null,
    }))
    .sort((a, b) => ordre(a.code) - ordre(b.code) || a.libelle.localeCompare(b.libelle));
}

// --- Contrôles

async function verifierSaisie(v: Partial<SaisieProjet>) {
  if (v.intitule !== undefined) texteObligatoire(v.intitule, "Intitulé");
  if (v.missionCode !== undefined) {
    const [l] = await query("select archive from mission where code = ?", [v.missionCode]);
    if (!l) throw new ErreurMetier("Mission inconnue.");
    if (l[0]) throw new ErreurMetier("Cette mission n'est plus proposée.");
  }
  if (v.origineCode !== undefined) {
    const [l] = await query("select 1 from origine where code = ?", [v.origineCode]);
    if (!l) throw new ErreurMetier("Origine inconnue.");
  }
  if (v.apporteurId) await exiger("contact", v.apporteurId, "Apporteur");
  taux(v.tauxPb, "Taux d'honoraires");
  taux(v.tauxApportPb, "Commission d'apport");
  montant(v.forfaitTtc, "Forfait");
  montant(v.estimationTtc, "Estimation des travaux");
}

/** Référence suivante de l'année : « 2026-001 », « 2026-002 »… */
async function prochaineReference() {
  const annee = aujourdhui().slice(0, 4);
  const [l] = await query("select max(cast(substr(reference, 6) as integer)) from projet where reference like ?", [`${annee}-%`]);
  return `${annee}-${String(Number(l?.[0] ?? 0) + 1).padStart(3, "0")}`;
}

async function avecTravaux(projetId: string) {
  const [l] = await query("select m.avec_travaux from projet p join mission m on m.code = p.mission_code where p.id = ?", [projetId]);
  if (!l) throw new ErreurMetier("Projet introuvable.", 404);
  return !!l[0];
}

async function jalonAtteint(projetId: string, code: CodeJalon) {
  const [l] = await query("select 1 from jalon where projet_id = ? and code = ? and date_reelle is not null", [projetId, code]);
  return !!l;
}

const instructionJalon = (projetId: string, code: string, prevue: string | null | undefined, reelle: string | null | undefined): Statement => ({
  sql: `insert into jalon (id, projet_id, code, date_prevue, date_reelle) values (?, ?, ?, ?, ?)
        on conflict (projet_id, code) do update set
          date_prevue = case when ? then excluded.date_prevue else date_prevue end,
          date_reelle = case when ? then excluded.date_reelle else date_reelle end`,
  params: [newId(), projetId, code, prevue ?? null, reelle ?? null, prevue !== undefined ? 1 : 0, reelle !== undefined ? 1 : 0],
});

// --- Écriture

/** Nouveau projet (et son client s'il est nouveau) ; le jalon « Réception du prospect » est daté. Renvoie l'id. */
export async function creerProjet(v: NouveauProjet) {
  await verifierSaisie(v);
  texteObligatoire(v.intitule, "Intitulé");
  const recuLe = dateFacultative(v.recuLe, "Date de réception") ?? aujourdhui();
  let clientId = v.clientId ?? null;
  if (!clientId && v.nouveauClient) clientId = await creerContact({ ...v.nouveauClient, type: "client" });
  if (!clientId) throw new ErreurMetier("Client : obligatoire.");
  const [c] = await query("select type from contact where id = ?", [clientId]);
  if (!c) throw new ErreurMetier("Client introuvable.", 404);
  if (c[0] !== "client") throw new ErreurMetier("Le client d'un projet doit être un contact de type client.");
  const apportDefaut = await parametre<number>("apport_defaut_pb", 1000);
  const id = newId();
  await batch([
    {
      sql: `insert into projet (id, reference, intitule, client_id, mission_code, origine_code, apporteur_id, adresse, taux_apport_pb, notes)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, await prochaineReference(), v.intitule.trim(), clientId, v.missionCode, v.origineCode, v.apporteurId || null, texteLibre(v.adresse), v.apporteurId ? apportDefaut : null, texteLibre(v.notes)],
    },
    instructionJalon(id, "reception_prospect", undefined, recuLe),
  ]);
  return id;
}

/** Modifie un projet (version : `modifieLe` lu par le navigateur). */
export async function majProjet(id: string, patch: Partial<SaisieProjet>, version?: string | null) {
  await exiger("projet", id, "Projet");
  await verifierVersion("projet", id, version);
  const v = sansTrace(patch);
  await verifierSaisie(v);
  if (v.missionCode !== undefined && (await jalonAtteint(id, "validation_mission"))) {
    const [l] = await query("select mission_code from projet where id = ?", [id]);
    if (l[0] !== v.missionCode) throw new ErreurMetier("La mission est validée : elle ne peut plus changer.");
  }
  await db
    .update(projet)
    .set({
      ...(v.intitule !== undefined ? { intitule: v.intitule.trim() } : {}),
      ...(v.missionCode !== undefined ? { missionCode: v.missionCode } : {}),
      ...(v.origineCode !== undefined ? { origineCode: v.origineCode } : {}),
      ...(v.apporteurId !== undefined ? { apporteurId: v.apporteurId || null } : {}),
      ...(v.adresse !== undefined ? { adresse: texteLibre(v.adresse) } : {}),
      ...(v.estimationTtc !== undefined ? { estimationTtc: v.estimationTtc } : {}),
      ...(v.tauxPb !== undefined ? { tauxPb: v.tauxPb } : {}),
      ...(v.forfaitTtc !== undefined ? { forfaitTtc: v.forfaitTtc } : {}),
      ...(v.tauxApportPb !== undefined ? { tauxApportPb: v.tauxApportPb } : {}),
      ...(v.notes !== undefined ? { notes: texteLibre(v.notes) } : {}),
    })
    .where(eq(projet.id, id));
  return versionDe("projet", id);
}

/**
 * Date prévue et / ou réelle d'un jalon (`undefined` : inchangée, `null` : effacée). Une date réelle ne peut pas
 * être dans le futur ; la validation des devis passe par `validerDevis` (tranches).
 */
export async function fixerJalon(projetId: string, code: string, dates: { datePrevue?: string | null; dateReelle?: string | null }) {
  const travaux = await avecTravaux(projetId);
  if (!CODES_JALONS.has(code as CodeJalon) || !jalonsPour(travaux).some((j) => j.code === code)) throw new ErreurMetier("Jalon inconnu pour cette mission.");
  if (JALONS_DEDIES.includes(code as CodeJalon) && dates.dateReelle) throw new ErreurMetier("La validation des devis se fait par « Valider les devis » (choix des lots).");
  const prevue = dates.datePrevue === undefined ? undefined : dateFacultative(dates.datePrevue, "Date prévue");
  const reelle = dates.dateReelle === undefined ? undefined : dateFacultative(dates.dateReelle, "Date réelle");
  if (reelle && reelle > aujourdhui()) throw new ErreurMetier("Une date réelle ne peut pas être dans le futur : saisissez-la comme date prévue.");
  await batch([instructionJalon(projetId, code, prevue, reelle)]);
  // Mission validée : son échéancier entre dans la trésorerie (une fois ; ensuite, mise à jour à la demande).
  if (reelle && (code === "validation_mission" || code === "signature_contrat") && !(await aDesEcheances(projetId))) await planifier(projetId);
}

/**
 * Validation des devis (décidé le 22/11/2026, « un projet par tranche ») : les lots cochés restent et le projet
 * passe en préparation ; les autres lots partent, avec leurs devis et documents, dans un nouveau projet « tranche »
 * lié, qui reprend les jalons déjà atteints jusqu'à la réception des devis. Renvoie l'id de la tranche créée (ou null).
 */
export async function validerDevis(projetId: string, lotsRetenus: string[], date: string) {
  if (!(await avecTravaux(projetId))) throw new ErreurMetier("Cette mission n'a pas de devis d'entreprises.");
  if (await jalonAtteint(projetId, "validation_devis")) throw new ErreurMetier("Les devis de ce projet sont déjà validés.");
  const d = dateFacultative(date, "Date de validation");
  if (!d) throw new ErreurMetier("Date de validation : obligatoire.");
  if (d > aujourdhui()) throw new ErreurMetier("Une date réelle ne peut pas être dans le futur : saisissez-la comme date prévue.");
  const lots = await db.select().from(lot).where(and(eq(lot.projetId, projetId), eq(lot.archive, false)));
  if (!lotsRetenus.length) throw new ErreurMetier("Cochez au moins un lot validé (sinon, le projet est perdu ou abandonné).");
  for (const l of lotsRetenus) {
    const x = lots.find((y) => y.id === l);
    if (!x) throw new ErreurMetier("Lot inconnu pour ce projet.");
    if (!x.montantTtc) throw new ErreurMetier(`Lot ${x.numero} (${x.corpsEtat}) : retenez d'abord un devis.`);
  }
  const partants = lots.filter((l) => !lotsRetenus.includes(l.id));
  const sts: Statement[] = [instructionJalon(projetId, "validation_devis", undefined, d)];
  let tranche: string | null = null;
  if (partants.length) {
    const [p] = await db.select().from(projet).where(eq(projet.id, projetId));
    const [n] = await query("select count(*) from projet where projet_origine_id = ? or id = ?", [projetId, projetId]);
    tranche = newId();
    const base = p.intitule.replace(/ — tranche \d+$/, "");
    sts.push({
      sql: `insert into projet (id, reference, intitule, client_id, mission_code, origine_code, apporteur_id, projet_origine_id, adresse, taux_pb, forfait_ttc, taux_apport_pb, notes)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [tranche, await prochaineReference(), `${base} — tranche ${Number(n[0]) + 1}`, p.clientId, p.missionCode, p.origineCode, p.apporteurId, projetId, p.adresse, p.tauxPb, null, p.tauxApportPb, null],
    });
    const ordre = JALONS.map((j) => j.code);
    const limite = ordre.indexOf("reception_devis");
    for (const j of await db.select().from(jalon).where(eq(jalon.projetId, projetId)))
      if (ordre.indexOf(j.code as CodeJalon) <= limite) sts.push(instructionJalon(tranche, j.code, j.datePrevue, j.dateReelle));
    const ids = partants.map((l) => l.id);
    const marques = ids.map(() => "?").join(", ");
    sts.push({ sql: `update lot set projet_id = ? where id in (${marques})`, params: [tranche, ...ids] });
    sts.push({ sql: `update document set projet_id = ? where lot_id in (${marques})`, params: [tranche, ...ids] });
  }
  await batch(sts);
  // Les montants sont désormais connus : l'échéancier (honoraires, commissions, apport) est mis à jour.
  await planifier(projetId);
  return tranche;
}

/** Projet perdu ou abandonné (motif obligatoire), possible tant que les devis (ou le rapport) ne sont pas validés. */
export async function cloreProjet(id: string, issue: "perdu" | "abandonne", motif: string) {
  await exiger("projet", id, "Projet");
  if (issue !== "perdu" && issue !== "abandonne") throw new ErreurMetier("Issue inconnue.");
  if ((await jalonAtteint(id, "validation_devis")) || (await jalonAtteint(id, "remise_rapport"))) throw new ErreurMetier("Ce projet est engagé : il ne peut plus être déclaré perdu ou abandonné.");
  await db.update(projet).set({ issue, motifIssue: texteObligatoire(motif, "Motif", 500) }).where(eq(projet.id, id));
}

/** Rouvre un projet perdu ou abandonné. */
export async function rouvrirProjet(id: string) {
  await exiger("projet", id, "Projet");
  await db.update(projet).set({ issue: "en_cours", motifIssue: null }).where(eq(projet.id, id));
}

/** Archive (ou ressort des archives) un projet : rien n'est effacé. */
export async function archiverProjet(id: string, archive: boolean) {
  await exiger("projet", id, "Projet");
  await query("update projet set archive = ? where id = ?", [archive ? 1 : 0, id]);
}

