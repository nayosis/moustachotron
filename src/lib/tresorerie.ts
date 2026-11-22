/**
 * Prévisionnel de trésorerie (conception § Trésorerie, skill `tresorerie`) : fonctions pures, en centimes TTC
 * signés (+ encaissement, − décaissement), partagées par le serveur et l'interface.
 *
 * solde(D) = solde réel aujourd'hui + Σ flux prévus de ]aujourd'hui, D]
 * flux prévus = échéances non réglées (datées par leur jalon) + occurrences des charges récurrentes
 *             + redevances du réseau (sur CA du mois précédent, assurance) + TVA du mois précédent à reverser.
 * Les échéances en retard (date passée, non réglées) ne sont pas comptées : elles sont signalées à part.
 */
import { htDepuisTtc } from "./prix";

/** Catégories de recettes du réseau : base de la redevance sur CA. */
export const CATEGORIES_RESEAU = ["hono_amo", "hono_moe", "courtage", "eaa", "commission_edb", "audit"];
/** Catégorie d'honoraires de chaque mission (échéances des projets). */
export const CATEGORIE_MISSION: Record<string, string> = { AMO: "hono_amo", MOE: "hono_moe", COU: "courtage", EAA: "eaa", EXP: "expertise", AUD: "audit" };
/** Mission dont relèvent les honoraires d'une catégorie (redevance assurance). */
const MISSION_CATEGORIE: Record<string, string> = { hono_amo: "AMO", hono_moe: "MOE", courtage: "COU" };

export type EcheancePrev = {
  id: string;
  libelle: string;
  projetLibelle: string;
  /** Date effective (forcée, sinon date réelle ou prévue du jalon) ; null : pas encore datée. */
  date: string | null;
  sens: "entree" | "sortie";
  ttc: number;
  ht: number;
  categorieId: string;
  statut: "prevue" | "facturee" | "reglee";
  /** Probabilité en pb (10 000 = certaine), utilisée en mode pondéré. */
  probaPb: number;
};

export type ChargePrev = {
  id: string;
  libelle: string;
  categorieId: string;
  montantTtc: number;
  tvaPb: number;
  periodicite: "mensuelle" | "trimestrielle" | "annuelle";
  jour: number;
  debut: string;
  fin: string | null;
};

/** Agrégats réalisés d'un mois « AAAA-MM » (mouvements), utiles aux redevances et à la TVA du mois suivant. */
export type RealiseMois = {
  reseauHt: number;
  honorairesHtParCategorie: Record<string, number>;
  tvaNette: number;
  /** Paiement de TVA déjà enregistré dans le mois (TTC signé) : la TVA du mois précédent est alors réglée. */
  tvaPayee?: number;
};

export type Reglages = {
  tvaJour: number;
  redevanceCaPb: number;
  redevanceCaJour: number;
  /** Taux de redevance assurance par mission (pb des honoraires HT) : { COU: 50, AMO: 300, MOE: 750 }. */
  redevanceAssurancePb: Record<string, number>;
};

export type Contexte = {
  aujourdhui: string;
  soldeReel: number;
  echeances: EcheancePrev[];
  charges: ChargePrev[];
  realise: Record<string, RealiseMois>;
  reglages: Reglages;
  pondere?: boolean;
  /**
   * Mouvements déjà saisis mais datés après aujourd'hui (prélèvement annoncé, ligne reprise des tableurs) : ils ne
   * sont pas dans le solde réel, mais tombent à leur date. Leur TVA est déjà dans `realise` (mois de leur date).
   */
  mouvementsFuturs?: { date: string; ttc: number; ht: number; categorieId: string; libelle: string }[];
};

export type Flux = {
  date: string;
  montant: number;
  libelle: string;
  type: "echeance" | "charge" | "redevance" | "tva";
  categorieId: string | null;
  /** HT signé (vue prévu / réalisé). */
  ht: number;
};

// --- Dates « AAAA-MM-JJ » (calculs en UTC, sans heure : pas de décalage de fuseau)

const enDate = (d: string) => new Date(`${d}T00:00:00Z`);
const versTexte = (d: Date) => d.toISOString().slice(0, 10);
export const ajouterJours = (d: string, n: number) => {
  const x = enDate(d);
  x.setUTCDate(x.getUTCDate() + n);
  return versTexte(x);
};
export const mois = (d: string) => d.slice(0, 7);
/** Jour J d'un mois (ramené au dernier jour pour les mois courts : le 31 en février tombe le 28 ou 29). */
export function jourDuMois(annee: number, moisIndex0: number, jour: number) {
  const dernier = new Date(Date.UTC(annee, moisIndex0 + 1, 0)).getUTCDate();
  return versTexte(new Date(Date.UTC(annee, moisIndex0, Math.min(jour, dernier))));
}
/** Mois suivant « AAAA-MM ». */
export function moisSuivant(m: string, n = 1) {
  const [a, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(a, mm - 1 + n, 1));
  return versTexte(d).slice(0, 7);
}
/** Ajoute N mois à une date (jour ramené au dernier jour si besoin) : « +1 mois » du 31 janvier = 28 février. */
export function ajouterMois(d: string, n: number) {
  const [a, m, j] = d.split("-").map(Number);
  return jourDuMois(a, m - 1 + n, j);
}

/** Dates d'une charge récurrente dans ]de, a]. */
export function occurrences(c: ChargePrev, de: string, a: string): string[] {
  const pas = c.periodicite === "mensuelle" ? 1 : c.periodicite === "trimestrielle" ? 3 : 12;
  const [ad, md] = c.debut.split("-").map(Number);
  const res: string[] = [];
  for (let i = 0; i < 1200; i++) {
    const d = jourDuMois(ad, md - 1 + i * pas, c.jour);
    if (d < c.debut) continue;
    if (d > a || (c.fin && d > c.fin)) break;
    if (d > de) res.push(d);
  }
  return res;
}

const tvaDe = (ttc: number, ht: number) => ttc - ht;

/**
 * Tous les flux prévus de ]aujourd'hui, fin]. Les redevances et la TVA d'un mois M se paient le mois M+1 (jours
 * réglables) ; leur base mêle le réalisé du mois M (mouvements) et ce qui reste prévu en M.
 */
export function fluxPrevus(ctx: Contexte, fin: string): Flux[] {
  const { aujourdhui: aujd, reglages: r } = ctx;
  const flux: Flux[] = [];
  // Base des calculs mensuels : prévus de chaque mois (ce qui n'est pas encore réalisé).
  const prevusMois: Record<string, RealiseMois> = {};
  const base = (m: string) => (prevusMois[m] ??= { reseauHt: 0, honorairesHtParCategorie: {}, tvaNette: 0 });

  for (const e of ctx.echeances) {
    if (e.statut === "reglee" || !e.date || e.date <= aujd || e.date > fin) continue;
    const poids = ctx.pondere ? e.probaPb / 10_000 : 1;
    const signe = e.sens === "entree" ? 1 : -1;
    const ttc = Math.round(e.ttc * poids) * signe;
    const ht = Math.round(e.ht * poids) * signe;
    flux.push({ date: e.date, montant: ttc, libelle: `${e.projetLibelle} — ${e.libelle}`, type: "echeance", categorieId: e.categorieId, ht });
    const b = base(mois(e.date));
    if (CATEGORIES_RESEAU.includes(e.categorieId) && signe > 0) b.reseauHt += ht;
    if (signe > 0) b.honorairesHtParCategorie[e.categorieId] = (b.honorairesHtParCategorie[e.categorieId] ?? 0) + ht;
    b.tvaNette += tvaDe(ttc, ht);
  }
  for (const m of ctx.mouvementsFuturs ?? []) {
    if (m.date > aujd && m.date <= fin) flux.push({ date: m.date, montant: m.ttc, libelle: m.libelle, type: m.ttc < 0 ? "charge" : "echeance", categorieId: m.categorieId, ht: m.ht });
  }
  for (const c of ctx.charges) {
    const ht = htDepuisTtc(c.montantTtc, c.tvaPb);
    for (const d of occurrences(c, aujd, fin)) {
      flux.push({ date: d, montant: -c.montantTtc, libelle: c.libelle, type: "charge", categorieId: c.categorieId, ht: -ht });
      base(mois(d)).tvaNette -= c.montantTtc - ht;
    }
  }

  // Redevances (sur le mois M, payées en M+1) puis TVA (idem) : du mois précédent jusqu'au mois de fin.
  let m = moisSuivant(mois(aujd), -1);
  const dernier = mois(fin);
  while (m <= dernier) {
    const reel = ctx.realise[m] ?? { reseauHt: 0, honorairesHtParCategorie: {}, tvaNette: 0 };
    const prev = prevusMois[m] ?? { reseauHt: 0, honorairesHtParCategorie: {}, tvaNette: 0 };
    const [a, mm] = moisSuivant(m).split("-").map(Number);
    const dateRedevance = jourDuMois(a, mm - 1, r.redevanceCaJour);
    let assurance = 0;
    for (const [cat, mission] of Object.entries(MISSION_CATEGORIE)) {
      const totalHt = (reel.honorairesHtParCategorie[cat] ?? 0) + (prev.honorairesHtParCategorie[cat] ?? 0);
      assurance += Math.round((totalHt * (r.redevanceAssurancePb[mission] ?? 0)) / 10_000);
    }
    const redevanceCa = Math.round(((reel.reseauHt + prev.reseauHt) * r.redevanceCaPb) / 10_000);
    if (dateRedevance > aujd && dateRedevance <= fin) {
      // Redevances facturées par le réseau avec TVA à 20 %.
      if (redevanceCa > 0) flux.push({ date: dateRedevance, montant: -Math.round(redevanceCa * 1.2), libelle: `Redevance sur CA (${m})`, type: "redevance", categorieId: "redevance_ca", ht: -redevanceCa });
      if (assurance > 0) flux.push({ date: dateRedevance, montant: -Math.round(assurance * 1.2), libelle: `Redevance assurance (${m})`, type: "redevance", categorieId: "redevance_assurance", ht: -assurance });
      // Leur TVA est déductible le mois du paiement.
      base(mois(dateRedevance)).tvaNette -= Math.round(redevanceCa * 0.2) + Math.round(assurance * 0.2);
    }
    const dateTva = jourDuMois(a, mm - 1, r.tvaJour);
    const tva = reel.tvaNette + (prevusMois[m]?.tvaNette ?? 0);
    // Crédit de TVA : rien à payer (on ne prévoit pas de remboursement).
    // TVA du mois déjà payée (un mouvement de TVA est enregistré le mois suivant) : rien à prévoir en plus.
    const dejaPayee = !!ctx.realise[moisSuivant(m)]?.tvaPayee;
    if (tva > 0 && !dejaPayee && dateTva > aujd && dateTva <= fin) flux.push({ date: dateTva, montant: -tva, libelle: `TVA de ${m}`, type: "tva", categorieId: "tva", ht: 0 });
    m = moisSuivant(m);
  }
  return flux.sort((x, y) => x.date.localeCompare(y.date));
}

/** Solde prévu à une date, avec le détail des flux jusqu'à elle. */
export function projection(ctx: Contexte, date: string) {
  if (date <= ctx.aujourdhui) return { date, solde: ctx.soldeReel, entrees: 0, sorties: 0, flux: [] as Flux[] };
  const flux = fluxPrevus(ctx, date);
  const entrees = flux.filter((f) => f.montant > 0).reduce((s, f) => s + f.montant, 0);
  const sorties = flux.filter((f) => f.montant < 0).reduce((s, f) => s + f.montant, 0);
  return { date, solde: ctx.soldeReel + entrees + sorties, entrees, sorties, flux };
}

/** Solde jour par jour de aujourd'hui à `fin` (courbe). */
export function serie(ctx: Contexte, fin: string) {
  const flux = fluxPrevus(ctx, fin);
  const points: { date: string; solde: number }[] = [];
  let solde = ctx.soldeReel;
  let i = 0;
  for (let d = ctx.aujourdhui; d <= fin; d = ajouterJours(d, 1)) {
    while (i < flux.length && flux[i].date <= d) solde += flux[i++].montant;
    points.push({ date: d, solde });
  }
  return points;
}

/** Échéances en retard : date passée, non réglées. */
export const enRetard = (ctx: Contexte) => ctx.echeances.filter((e) => e.statut !== "reglee" && e.date && e.date <= ctx.aujourdhui);

/** Libellé d'un horizon en jours : « Aujourd'hui », « +1 mois », « +3 mois », « +45 j ». */
export const libelleHorizon = (j: number) => (j === 0 ? "Aujourd'hui" : j % 30 === 0 ? `+${j / 30} mois` : `+${j} j`);

/** Date d'un horizon : « +N mois » se compte en mois calendaires (du 22/11 au 22/12), les autres en jours. */
export const dateHorizon = (aujourdhui: string, j: number) => (j > 0 && j % 30 === 0 ? ajouterMois(aujourdhui, j / 30) : ajouterJours(aujourdhui, j));
