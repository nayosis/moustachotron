/*
 * Trésorerie : vue prévisionnelle (horizons), prévu / réalisé par mois et catégorie, mouvements, charges
 * récurrentes, exercices. Conception § Trésorerie ; calculs purs dans src/lib/tresorerie.ts (skill `tresorerie`).
 */
import { and, asc, desc, eq, gte, like, lte, or, type SQL } from "drizzle-orm";
import { batch, db, newId, query, type Statement } from "../db/client";
import { categorie, chargeRecurrente, document, exercice, mouvement } from "../db/schema";
import { ErreurMetier } from "../../serveur/erreurs";
import { aujourdhui } from "../lib/dates";
import { htDepuisTtc } from "../lib/prix";
import {
  CATEGORIES_RESEAU, dateHorizon, enRetard, libelleHorizon, mois, moisSuivant, occurrences, projection, serie,
  type ChargePrev, type Contexte, type EcheancePrev, type RealiseMois,
} from "../lib/tresorerie";
import { DATE, dateFacultative, exiger, instructionsDocuments, montant, parametre, taux, texteLibre, texteObligatoire, type FichierARattacher } from "./_commun";
import type { ModeReglement } from "./echeances";

export type SaisieMouvement = {
  date: string;
  tiers?: string | null;
  mode: ModeReglement;
  objet: string;
  categorieId: string;
  /** Montant TTC : positif (le signe vient de la catégorie), ou signé pour la TVA et le financement. */
  ttc: number;
  /** TVA (pb) ; par défaut celle de la catégorie. */
  tvaPb?: number | null;
  projetId?: string | null;
  reference?: string | null;
  dateEmission?: string | null;
};
export type SaisieCharge = {
  libelle: string;
  tiers?: string | null;
  categorieId: string;
  montantTtc: number;
  tvaPb?: number | null;
  periodicite: "mensuelle" | "trimestrielle" | "annuelle";
  jour: number;
  debut: string;
  fin?: string | null;
  motCle?: string | null;
};

// --- Contexte du prévisionnel (outils internes)

/** Exercice qui contient une date (sinon le plus récent commencé avant). */
async function exerciceDe(date: string) {
  const [e] = await db.select().from(exercice).where(and(lte(exercice.debut, date), gte(exercice.fin, date)));
  if (e) return e;
  const [avant] = await db.select().from(exercice).where(lte(exercice.debut, date)).orderBy(desc(exercice.debut)).limit(1);
  return avant ?? null;
}

/** Solde réel en fin de journée : ouverture de l'exercice + mouvements depuis son début. */
async function soldeAu(date: string) {
  const e = await exerciceDe(date);
  const [l] = await query("select coalesce(sum(ttc), 0) from mouvement where archive = 0 and date <= ? and date >= ?", [date, e?.debut ?? "0000-00-00"]);
  return (e?.tresorerieOuverture ?? 0) + Number(l[0]);
}

/** Échéances non archivées des projets en cours, datées par leur jalon (ou leur date forcée). */
async function echeancesPrev(): Promise<(EcheancePrev & { projetId: string; reference: string; clientNom: string; numeroFacture: string | null; code: string })[]> {
  const probaAvantDevis = await parametre<number>("proba_avant_devis_pb", 5000);
  const lignes = await query(
    `select e.id, e.libelle, e.sens, e.ttc, e.ht, e.categorie_id, e.statut, e.code, e.numero_facture,
            coalesce(e.date_forcee, j.date_reelle, j.date_prevue),
            p.id, p.reference, c.nom, m.avec_travaux,
            exists (select 1 from jalon v where v.projet_id = p.id and v.code = 'validation_devis' and v.date_reelle is not null)
     from echeance e
     join projet p on p.id = e.projet_id join contact c on c.id = p.client_id join mission m on m.code = p.mission_code
     left join jalon j on j.projet_id = e.projet_id and j.code = e.jalon
     where e.archive = 0 and p.archive = 0 and p.issue = 'en_cours'`,
  );
  return lignes.map(([id, libelle, sens, ttc, ht, categorieId, statut, code, numeroFacture, date, projetId, reference, clientNom, avecTravaux, devisValides]) => ({
    id: String(id),
    libelle: String(libelle),
    projetLibelle: `${clientNom} (${reference})`,
    sens: sens as "entree" | "sortie",
    ttc: Number(ttc),
    ht: Number(ht),
    categorieId: String(categorieId),
    statut: statut as "prevue" | "facturee" | "reglee",
    code: String(code),
    numeroFacture: (numeroFacture as string | null) ?? null,
    date: (date as string | null) ?? null,
    projetId: String(projetId),
    reference: String(reference),
    clientNom: String(clientNom),
    // Avant la validation des devis, tout ce qui dépend des travaux est incertain (mode pondéré).
    probaPb: avecTravaux && !devisValides && code !== "acompte" ? probaAvantDevis : 10_000,
  }));
}

async function chargesPrev(): Promise<ChargePrev[]> {
  const l = await db.select().from(chargeRecurrente).where(eq(chargeRecurrente.archive, false));
  return l.map((c) => ({ id: c.id, libelle: c.libelle, categorieId: c.categorieId, montantTtc: c.montantTtc, tvaPb: c.tvaPb, periodicite: c.periodicite, jour: c.jour, debut: c.debut, fin: c.fin }));
}

/** Réalisé par mois (mouvements) depuis une date : base des redevances et de la TVA du mois suivant. */
async function realiseDepuis(debut: string) {
  const lignes = await query(
    `select substr(m.date, 1, 7), m.categorie_id, c.sens, sum(m.ht), sum(m.ttc)
     from mouvement m join categorie c on c.id = m.categorie_id where m.archive = 0 and m.date >= ? group by 1, 2`,
    [debut],
  );
  const r: Record<string, RealiseMois> = {};
  for (const [moisTexte, cat, sens, ht, ttc] of lignes) {
    const x = (r[String(moisTexte)] ??= { reseauHt: 0, honorairesHtParCategorie: {}, tvaNette: 0 });
    const categorieId = String(cat);
    if (sens === "recette") {
      if (CATEGORIES_RESEAU.includes(categorieId)) x.reseauHt += Number(ht);
      x.honorairesHtParCategorie[categorieId] = (x.honorairesHtParCategorie[categorieId] ?? 0) + Number(ht);
    }
    if (sens === "recette" || sens === "depense") x.tvaNette += Number(ttc) - Number(ht);
    if (sens === "tva") x.tvaPayee = (x.tvaPayee ?? 0) + Number(ttc);
  }
  return r;
}

async function contexte(pondere = false): Promise<Contexte & { echeancesDetail: Awaited<ReturnType<typeof echeancesPrev>> }> {
  const aujd = aujourdhui();
  const [soldeReel, echeances, charges, realise, tvaJour, redevanceCaPb, redevanceCaJour, redevanceAssurancePb, futurs] = await Promise.all([
    soldeAu(aujd),
    echeancesPrev(),
    chargesPrev(),
    realiseDepuis(`${moisSuivant(mois(aujd), -1)}-01`),
    parametre<number>("tva_jour", 25),
    parametre<number>("redevance_ca_pb", 500),
    parametre<number>("redevance_ca_jour", 15),
    parametre<Record<string, number>>("redevance_assurance_pb", { COU: 50, AMO: 300, MOE: 750 }),
    query("select date, ttc, ht, categorie_id, objet from mouvement where archive = 0 and date > ? order by date", [aujd]),
  ]);
  const mouvementsFuturs = futurs.map(([date, ttc, ht, categorieId, objet]) => ({ date: String(date), ttc: Number(ttc), ht: Number(ht), categorieId: String(categorieId), libelle: String(objet) }));
  return { aujourdhui: aujd, soldeReel, echeances, echeancesDetail: echeances, charges, realise, mouvementsFuturs, reglages: { tvaJour, redevanceCaPb, redevanceCaJour, redevanceAssurancePb }, pondere };
}

// --- Lecture

/** Listes de la trésorerie : catégories, exercices, horizons réglés. */
export async function referentielTresorerie() {
  const [categories, exercices, horizons] = await Promise.all([
    db.select().from(categorie).orderBy(asc(categorie.ordre)),
    db.select().from(exercice).orderBy(desc(exercice.debut)),
    parametre<number[]>("horizons_jours", [0, 30, 90]),
  ]);
  return { categories, exercices, horizons };
}

/**
 * Vue de trésorerie : solde réel, solde prévu à chaque horizon (jours réglés + date choisie), courbe jour par jour,
 * prochains flux, échéances en retard, reste à facturer. `pondere` : échéances incertaines pondérées.
 */
export async function vueTresorerie(options: { dateChoisie?: string | null; pondere?: boolean } = {}) {
  const ctx = await contexte(!!options.pondere);
  const horizons = await parametre<number[]>("horizons_jours", [0, 30, 90]);
  const points = horizons.map((j) => ({ jours: j as number | null, libelle: libelleHorizon(j), date: dateHorizon(ctx.aujourdhui, j) }));
  // Fin du mois en cours : toujours affichée après « Aujourd'hui » (décidé le 22/11/2026, vue terrain comprise).
  const [a, m] = ctx.aujourdhui.split("-").map(Number);
  const finDuMois = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  if (finDuMois > ctx.aujourdhui && !points.some((p) => p.date === finDuMois)) {
    points.splice(points[0]?.jours === 0 ? 1 : 0, 0, { jours: null, libelle: "Fin du mois", date: finDuMois });
  }
  const choisie = dateFacultative(options.dateChoisie, "Date choisie");
  if (choisie && choisie > ctx.aujourdhui) points.push({ jours: null, libelle: "Date choisie", date: choisie });
  const resultats = points.map((p) => {
    const r = projection(ctx, p.date);
    // En mode pondéré, on garde aussi le chiffre certain (les deux sont affichés).
    const certain = options.pondere ? projection({ ...ctx, pondere: false }, p.date).solde : r.solde;
    const parType = (t: string) => r.flux.filter((f) => f.type === t).reduce((s, f) => s + f.montant, 0);
    return { ...p, solde: r.solde, certain, entrees: r.entrees, sorties: r.sorties, charges: parType("charge"), tva: parType("tva"), redevances: parType("redevance"), echeances: parType("echeance") };
  });
  const fin = points.reduce((m, p) => (p.date > m ? p.date : m), ctx.aujourdhui);
  const finCourbe = fin > ctx.aujourdhui ? fin : dateHorizon(ctx.aujourdhui, 90);
  const prochains = projection(ctx, finCourbe).flux.slice(0, 40);
  const retards = enRetard(ctx).map((e) => ({ ...e, ...ctx.echeancesDetail.find((d) => d.id === e.id)! }));
  const nonReglees = ctx.echeancesDetail.filter((e) => e.statut !== "reglee" && e.sens === "entree");
  return {
    aujourdhui: ctx.aujourdhui,
    soldeReel: ctx.soldeReel,
    exercice: await exerciceDe(ctx.aujourdhui),
    horizons: resultats,
    serie: serie(ctx, finCourbe),
    prochains,
    retards,
    resteAFacturerTtc: nonReglees.filter((e) => e.statut === "prevue").reduce((s, e) => s + e.ttc, 0),
    factureNonRegleTtc: nonReglees.filter((e) => e.statut === "facturee").reduce((s, e) => s + e.ttc, 0),
    // Encaissements attendus sans date (jalon non daté) : à planifier pour entrer dans le prévisionnel.
    aDater: ctx.echeancesDetail.filter((e) => e.statut !== "reglee" && !e.date),
    aFacturer: ctx.echeancesDetail
      .filter((e) => e.statut === "prevue" && e.sens === "entree" && e.date && e.date > ctx.aujourdhui && e.date <= dateHorizon(ctx.aujourdhui, 30))
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
  };
}

/**
 * Prévu / réalisé / écart d'un exercice, par mois et par catégorie (HT, comme la « Synthèse Année N »), et
 * trésorerie de fin de mois (réelle pour les mois passés, prévue ensuite).
 */
export async function syntheseExercice(exerciceId: string) {
  const [e] = await db.select().from(exercice).where(eq(exercice.id, exerciceId));
  if (!e) throw new ErreurMetier("Exercice introuvable.", 404);
  const listeMois: string[] = [];
  for (let m = mois(e.debut); m <= mois(e.fin); m = moisSuivant(m)) listeMois.push(m);
  const [categories, realises, echeances, charges] = await Promise.all([
    db.select().from(categorie).orderBy(asc(categorie.ordre)),
    query("select substr(date, 1, 7), categorie_id, sum(ht), sum(ttc) from mouvement where archive = 0 and date >= ? and date <= ? group by 1, 2", [e.debut, e.fin]),
    echeancesPrev(),
    chargesPrev(),
  ]);
  const indice = new Map(listeMois.map((m, i) => [m, i]));
  const lignes = new Map(categories.map((c) => [c.id, { categorieId: c.id, libelle: c.libelle, groupe: c.groupe, sens: c.sens, prevu: listeMois.map(() => 0), realise: listeMois.map(() => 0) }]));
  const ttcRealise = listeMois.map(() => 0);
  for (const [m, cat, ht, ttc] of realises) {
    const i = indice.get(String(m));
    const l = lignes.get(String(cat));
    if (i === undefined || !l) continue;
    l.realise[i] += Number(ht);
    ttcRealise[i] += Number(ttc);
  }
  for (const x of echeances) {
    const i = x.date ? indice.get(mois(x.date)) : undefined;
    const l = lignes.get(x.categorieId);
    if (i === undefined || !l) continue;
    l.prevu[i] += (x.sens === "entree" ? 1 : -1) * x.ht;
  }
  const veille = (d: string) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() - 1);
    return x.toISOString().slice(0, 10);
  };
  for (const c of charges) {
    const l = lignes.get(c.categorieId);
    if (!l) continue;
    for (const d of occurrences(c, veille(e.debut), e.fin)) {
      const i = indice.get(mois(d));
      if (i !== undefined) l.prevu[i] -= htDepuisTtc(c.montantTtc, c.tvaPb);
    }
  }
  // Trésorerie de fin de mois : réelle jusqu'au mois courant, puis prévue (projection).
  const aujd = aujourdhui();
  const ctx = await contexte();
  let solde = e.tresorerieOuverture;
  const finDeMois = listeMois.map((m, i) => {
    const dernierJour = `${moisSuivant(m)}-01` > e.fin ? e.fin : veille(`${moisSuivant(m)}-01`);
    solde += ttcRealise[i];
    if (dernierJour <= aujd) return { mois: m, solde, prevu: false };
    return { mois: m, solde: projection(ctx, dernierJour).solde, prevu: true };
  });
  return { exercice: e, mois: listeMois, lignes: [...lignes.values()].filter((l) => l.prevu.some(Boolean) || l.realise.some(Boolean)), finDeMois, moisCourant: mois(aujd) };
}

/** Mouvements, du plus récent au plus ancien, filtrables par mois (« AAAA-MM »), catégorie et recherche. */
export async function listeMouvements(f: { mois?: string; categorieId?: string; recherche?: string } = {}) {
  const conditions: SQL[] = [eq(mouvement.archive, false)];
  if (f.mois) conditions.push(like(mouvement.date, `${f.mois}-%`));
  if (f.categorieId) conditions.push(eq(mouvement.categorieId, f.categorieId));
  const r = f.recherche?.trim();
  if (r) conditions.push(or(like(mouvement.objet, `%${r}%`), like(mouvement.tiers, `%${r}%`), like(mouvement.reference, `%${r}%`))!);
  const [lignes, justificatifs] = await Promise.all([
    db.select().from(mouvement).where(and(...conditions)).orderBy(desc(mouvement.date), desc(mouvement.creeLe)),
    db.select({ mouvementId: document.mouvementId, fichier: document.fichier, nom: document.nom }).from(document).where(eq(document.archive, false)),
  ]);
  return lignes.map((m) => ({ ...m, justificatifs: justificatifs.filter((j) => j.mouvementId === m.id) }));
}

/** Charges récurrentes actives. */
export async function listeChargesRecurrentes() {
  return db.select().from(chargeRecurrente).where(eq(chargeRecurrente.archive, false)).orderBy(asc(chargeRecurrente.jour), asc(chargeRecurrente.libelle));
}

// --- Contrôles

async function lireCategorie(id: string) {
  const [c] = await db.select().from(categorie).where(eq(categorie.id, id));
  if (!c) throw new ErreurMetier("Catégorie inconnue.");
  return c;
}

const MODES = ["virement", "prelevement", "cb", "cheque", "especes", "autre"];

/** Montants signés d'un mouvement : le signe vient de la catégorie (recette +, dépense −), sauf TVA et financement. */
async function montants(v: Pick<SaisieMouvement, "categorieId" | "ttc" | "tvaPb">) {
  const c = await lireCategorie(v.categorieId);
  if (!Number.isInteger(v.ttc) || v.ttc === 0) throw new ErreurMetier("Montant TTC invalide.");
  if ((c.sens === "recette" || c.sens === "depense") && v.ttc < 0) throw new ErreurMetier("Montant TTC : saisissez un montant positif (le sens vient de la catégorie).");
  const tvaPb = taux(v.tvaPb, "TVA") ?? c.tvaPb;
  const ttc = c.sens === "depense" ? -v.ttc : v.ttc;
  const ht = c.sens === "tva" || c.sens === "financement" ? ttc : Math.sign(ttc) * htDepuisTtc(Math.abs(ttc), tvaPb);
  return { ttc, ht, tva: ttc - ht };
}

// --- Écriture : mouvements

/** Nouvelle recette ou dépense ponctuelle (facture fournisseur, recette hors projet), avec son justificatif. */
export async function creerMouvement(v: SaisieMouvement, justificatifs: FichierARattacher[] = []) {
  if (!DATE.test(v.date ?? "")) throw new ErreurMetier("Date invalide.");
  if (!MODES.includes(v.mode)) throw new ErreurMetier("Mode de règlement inconnu.");
  if (v.projetId) await exiger("projet", v.projetId, "Projet");
  const m = await montants(v);
  const id = newId();
  const sts: Statement[] = [
    {
      sql: `insert into mouvement (id, date, tiers, mode, objet, categorie_id, ht, tva, ttc, projet_id, reference, date_emission, source)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saisie')`,
      params: [id, v.date, texteLibre(v.tiers), v.mode, texteObligatoire(v.objet, "Objet"), v.categorieId, m.ht, m.tva, m.ttc, v.projetId || null, texteLibre(v.reference), dateFacultative(v.dateEmission, "Date de la facture")],
    },
  ];
  if (justificatifs.length) sts.push(...(await instructionsDocuments(justificatifs, { projetId: v.projetId ?? null, mouvementId: id }, "facture_depense")));
  await batch(sts);
  return id;
}

/** Corrige un mouvement saisi (pas ceux créés par le règlement d'une échéance : annuler le règlement). */
export async function majMouvement(id: string, v: SaisieMouvement) {
  const [l] = await query("select source from mouvement where id = ? and archive = 0", [id]);
  if (!l) throw new ErreurMetier("Mouvement introuvable.", 404);
  if (l[0] === "echeance") throw new ErreurMetier("Ce mouvement vient du règlement d'une échéance : annulez le règlement depuis le projet.");
  if (!DATE.test(v.date ?? "")) throw new ErreurMetier("Date invalide.");
  const m = await montants(v);
  await query("update mouvement set date = ?, tiers = ?, mode = ?, objet = ?, categorie_id = ?, ht = ?, tva = ?, ttc = ?, projet_id = ?, reference = ? where id = ?", [
    v.date,
    texteLibre(v.tiers),
    v.mode,
    texteObligatoire(v.objet, "Objet"),
    v.categorieId,
    m.ht,
    m.tva,
    m.ttc,
    v.projetId || null,
    texteLibre(v.reference),
    id,
  ]);
}

/** Retire un mouvement saisi par erreur (archivé, reste dans le journal). */
export async function archiverMouvement(id: string) {
  const [l] = await query("select source from mouvement where id = ? and archive = 0", [id]);
  if (!l) throw new ErreurMetier("Mouvement introuvable.", 404);
  if (l[0] === "echeance") throw new ErreurMetier("Ce mouvement vient du règlement d'une échéance : annulez le règlement depuis le projet.");
  await query("update mouvement set archive = 1 where id = ?", [id]);
}

// --- Écriture : charges récurrentes

async function verifierCharge(v: SaisieCharge) {
  texteObligatoire(v.libelle, "Libellé");
  const c = await lireCategorie(v.categorieId);
  if (c.sens !== "depense") throw new ErreurMetier("Une charge récurrente se range dans une catégorie de dépense.");
  if (!montant(v.montantTtc, "Montant TTC", true)) throw new ErreurMetier("Montant TTC : doit être supérieur à zéro.");
  if (!["mensuelle", "trimestrielle", "annuelle"].includes(v.periodicite)) throw new ErreurMetier("Périodicité inconnue.");
  if (!Number.isInteger(v.jour) || v.jour < 1 || v.jour > 31) throw new ErreurMetier("Jour du mois : entre 1 et 31.");
  if (!DATE.test(v.debut ?? "")) throw new ErreurMetier("Date de début invalide.");
  const fin = dateFacultative(v.fin, "Date de fin");
  if (fin && fin < v.debut) throw new ErreurMetier("La fin doit suivre le début.");
  return { tvaPb: taux(v.tvaPb, "TVA") ?? c.tvaPb, fin };
}

/** Nouvelle charge récurrente. */
export async function creerChargeRecurrente(v: SaisieCharge) {
  const { tvaPb, fin } = await verifierCharge(v);
  const id = newId();
  await db.insert(chargeRecurrente).values({ id, libelle: v.libelle.trim(), tiers: texteLibre(v.tiers), categorieId: v.categorieId, montantTtc: v.montantTtc, tvaPb, periodicite: v.periodicite, jour: v.jour, debut: v.debut, fin, motCle: texteLibre(v.motCle) });
  return id;
}

/** Modifie une charge récurrente (pour changer un montant à partir d'une date : terminer celle-ci, en créer une autre). */
export async function majChargeRecurrente(id: string, v: SaisieCharge) {
  await exiger("charge_recurrente", id, "Charge");
  const { tvaPb, fin } = await verifierCharge(v);
  await db
    .update(chargeRecurrente)
    .set({ libelle: v.libelle.trim(), tiers: texteLibre(v.tiers), categorieId: v.categorieId, montantTtc: v.montantTtc, tvaPb, periodicite: v.periodicite, jour: v.jour, debut: v.debut, fin, motCle: texteLibre(v.motCle) })
    .where(eq(chargeRecurrente.id, id));
}

/** Retire une charge récurrente (archivée). */
export async function archiverChargeRecurrente(id: string) {
  await exiger("charge_recurrente", id, "Charge");
  await query("update charge_recurrente set archive = 1 where id = ?", [id]);
}

// --- Écriture : exercices et réglages

/** Trésorerie d'ouverture et objectif de CA d'un exercice. */
export async function majExercice(id: string, v: { tresorerieOuverture: number; objectifCaHt?: number | null }) {
  await exiger("exercice", id, "Exercice");
  if (!Number.isInteger(v.tresorerieOuverture)) throw new ErreurMetier("Trésorerie d'ouverture invalide.");
  await db.update(exercice).set({ tresorerieOuverture: v.tresorerieOuverture, objectifCaHt: montant(v.objectifCaHt, "Objectif de CA") }).where(eq(exercice.id, id));
}

/** Nouvel exercice de 12 mois à partir d'une date de début (le 1er juin par défaut). */
export async function creerExercice(debut: string, libelle: string) {
  if (!DATE.test(debut ?? "")) throw new ErreurMetier("Date de début invalide.");
  const d = new Date(`${debut}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  const fin = d.toISOString().slice(0, 10);
  const [chevauche] = await query("select 1 from exercice where debut <= ? and fin >= ?", [fin, debut]);
  if (chevauche) throw new ErreurMetier("Cet exercice chevauche un exercice existant.");
  const id = newId();
  await db.insert(exercice).values({ id, libelle: texteObligatoire(libelle, "Libellé"), debut, fin, tresorerieOuverture: 0 });
  return id;
}

/** Horizons du prévisionnel, en jours (0 = aujourd'hui ; multiples de 30 affichés en mois). */
export async function majHorizons(jours: number[]) {
  const propres = [...new Set(jours)].sort((a, b) => a - b);
  if (!propres.length || propres.some((j) => !Number.isInteger(j) || j < 0 || j > 730)) throw new ErreurMetier("Horizons : des nombres de jours entre 0 et 730.");
  await query("insert into parametre (cle, valeur) values ('horizons_jours', ?) on conflict (cle) do update set valeur = excluded.valeur", [JSON.stringify(propres)]);
}

