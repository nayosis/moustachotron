/**
 * Prix d'une mission, commissions et échéancier (conception § Montants d'un projet, décidé le 22/11/2026).
 * Fonctions pures, en centimes et points de base (pb : 1 500 = 15 %), partagées par le serveur et l'interface.
 *
 * Règle clé : le client ne paie que du TTC (taux × travaux TTC) ; le HT des honoraires suit la TVA de chaque lot
 * de travaux (pas 20 %). Seules les missions au forfait ont leur propre TVA (20 %).
 */

/** Taux de TVA proposés pour les travaux (pb). */
export const TVA_TRAVAUX = [550, 1000, 2000];

export type MissionPrix = {
  mode: "forfait" | "pourcentage";
  tauxPb: number | null;
  forfaitTtc: number | null;
  tvaPb: number | null;
  avecAcompte: boolean;
  echeancier: EtapeEcheancier[];
};
export type LotPrix = { montantTtc: number | null; tvaPb: number; commissionPb: number; archive?: boolean };
export type ProjetPrix = { tauxPb: number | null; forfaitTtc: number | null; tauxApportPb: number | null; estimationTtc?: number | null };

/**
 * Une étape d'encaissement des honoraires, attachée à un jalon.
 * `acompte` : montant du barème ; `part` : pourcentage du total TTC (acompte déduit si `deduireAcompte`) ;
 * `solde` : ce qui reste.
 */
export type EtapeEcheancier = { code: string; libelle: string; type: "acompte" | "part" | "solde"; partPb?: number; deduireAcompte?: boolean; jalon: string };

/** Barème de l'acompte : premier palier dont le plafond (inclus) couvre les travaux TTC ; plafond null = au-delà. */
export type PalierAcompte = { plafondTtc: number | null; acompteTtc: number };

export const BAREME_ACOMPTE_DEFAUT: PalierAcompte[] = [
  { plafondTtc: 1_999_999, acompteTtc: 50_000 },
  { plafondTtc: 7_500_000, acompteTtc: 75_000 },
  { plafondTtc: 10_000_000, acompteTtc: 100_000 },
  { plafondTtc: null, acompteTtc: 150_000 },
];

/** Arrondi au centime le plus proche (les montants sont entiers ; seuls les calculs intermédiaires sont décimaux). */
const arrondi = (x: number) => Math.round(x);

/** HT d'un montant TTC à un taux de TVA donné. */
export const htDepuisTtc = (ttc: number, tvaPb: number) => arrondi((ttc * 10_000) / (10_000 + tvaPb));

/** Applique un taux en pb. */
export const appliquer = (montant: number, pb: number) => arrondi((montant * pb) / 10_000);

const lotsRetenus = (lots: LotPrix[]) => lots.filter((l) => !l.archive && l.montantTtc != null && l.montantTtc > 0) as (LotPrix & { montantTtc: number })[];

/** Travaux du projet : TTC et HT (lot par lot, chacun à sa TVA). */
export function travaux(lots: LotPrix[]) {
  const r = lotsRetenus(lots);
  return { ttc: r.reduce((s, l) => s + l.montantTtc, 0), ht: r.reduce((s, l) => s + htDepuisTtc(l.montantTtc, l.tvaPb), 0) };
}

/** Honoraires de la mission, TTC (payé par le client) et HT (trésorerie). */
export function honoraires(mission: MissionPrix, projet: ProjetPrix, lots: LotPrix[]) {
  const t = travaux(lots);
  const forfait = projet.forfaitTtc ?? (mission.mode === "forfait" ? mission.forfaitTtc : null);
  if (forfait != null) {
    // Forfait : à la TVA de la mission ; sur une mission en % mise au forfait, à la TVA moyenne des travaux.
    if (mission.tvaPb != null) return { ttc: forfait, ht: htDepuisTtc(forfait, mission.tvaPb) };
    return { ttc: forfait, ht: t.ttc ? arrondi((forfait * t.ht) / t.ttc) : htDepuisTtc(forfait, 1000) };
  }
  if (mission.mode === "forfait") return { ttc: 0, ht: 0 };
  const taux = projet.tauxPb ?? mission.tauxPb ?? 0;
  let ttc = 0;
  let ht = 0;
  for (const l of lotsRetenus(lots)) {
    const h = appliquer(l.montantTtc, taux);
    ttc += h;
    ht += htDepuisTtc(h, l.tvaPb);
  }
  return { ttc, ht };
}

/** Commission d'une entreprise : HT du lot × taux. */
export const commissionLot = (l: LotPrix) => (l.montantTtc ? appliquer(htDepuisTtc(l.montantTtc, l.tvaPb), l.commissionPb) : 0);

/** Acompte TTC selon le barème et le montant TTC des travaux. */
export function acompte(travauxTtc: number, bareme: PalierAcompte[] = BAREME_ACOMPTE_DEFAUT) {
  const palier = bareme.find((p) => p.plafondTtc == null || travauxTtc <= p.plafondTtc);
  return palier?.acompteTtc ?? 0;
}

export type LigneEcheancier = { code: string; libelle: string; jalon: string; ttc: number; ht: number };

/**
 * Échéancier des honoraires : l'acompte (barème, plafonné au total), puis les parts (acompte déduit de la première
 * qui le demande ; un acompte plus grand que la part se reporte sur la suivante), puis le solde.
 */
export function echeancier(mission: MissionPrix, projet: ProjetPrix, lots: LotPrix[], bareme: PalierAcompte[] = BAREME_ACOMPTE_DEFAUT): LigneEcheancier[] {
  const h = honoraires(mission, projet, lots);
  if (h.ttc <= 0) return [];
  const versHt = (ttc: number) => arrondi((ttc * h.ht) / h.ttc);
  const lignes: LigneEcheancier[] = [];
  let facture = 0;
  let acompteADeduire = 0;
  for (const e of mission.echeancier) {
    let ttc = 0;
    if (e.type === "acompte") {
      if (!mission.avecAcompte) continue;
      ttc = Math.min(acompte(travaux(lots).ttc, bareme), h.ttc);
      acompteADeduire += ttc;
    } else if (e.type === "part") {
      ttc = appliquer(h.ttc, e.partPb ?? 0);
      if (e.deduireAcompte || acompteADeduire) {
        const deduit = Math.min(ttc, acompteADeduire);
        ttc -= deduit;
        acompteADeduire -= deduit;
      }
    } else ttc = h.ttc - facture;
    ttc = Math.max(0, Math.min(ttc, h.ttc - facture));
    facture += ttc;
    lignes.push({ code: e.code, libelle: e.libelle, jalon: e.jalon, ttc, ht: versHt(ttc) });
  }
  // Le HT arrondi ligne à ligne : l'écart d'arrondi va sur la dernière ligne pour que la somme tombe juste.
  const ecart = h.ht - lignes.reduce((s, l) => s + l.ht, 0);
  if (lignes.length && ecart) lignes[lignes.length - 1].ht += ecart;
  return lignes;
}

/**
 * Lots qui portent le calcul : les lots avec devis retenu ; à défaut, l'estimation des travaux du projet (un lot
 * fictif à 10 %, commission par défaut), pour l'acompte et le prévisionnel avant les devis.
 */
export function lotsEffectifs(projet: ProjetPrix, lots: LotPrix[], commissionPb = 1300): { lots: LotPrix[]; estime: boolean } {
  if (lotsRetenus(lots).length || !projet.estimationTtc) return { lots, estime: false };
  return { lots: [{ montantTtc: projet.estimationTtc, tvaPb: 1000, commissionPb }], estime: true };
}

/** Synthèse financière d'un projet (fiche projet, pipeline), sur les devis retenus ou, à défaut, l'estimation. */
export function syntheseProjet(mission: MissionPrix, projet: ProjetPrix, lotsSaisis: LotPrix[], bareme?: PalierAcompte[]) {
  const { lots, estime } = lotsEffectifs(projet, lotsSaisis);
  const t = travaux(lots);
  const h = honoraires(mission, projet, lots);
  const commissions = lotsRetenus(lots).reduce((s, l) => s + commissionLot(l), 0);
  const apport = projet.tauxApportPb ? appliquer(h.ht, projet.tauxApportPb) : 0;
  return { estime, travauxTtc: t.ttc, travauxHt: t.ht, honorairesTtc: h.ttc, honorairesHt: h.ht, commissionsHt: commissions, apportHt: apport, echeancier: echeancier(mission, projet, lots, bareme) };
}

/** « 15 % », « 12,75 % ». */
export const pourcent = (pb: number | null | undefined) => (pb == null ? "" : `${(pb / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`);

/** Saisie « 12,75 » ou « 12.75 % » → 1 275 pb ; null si illisible. */
export function lirePourcent(s: string): number | null {
  const t = s.replace(/[\s%]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
