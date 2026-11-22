/*
 * Échéancier d'un projet en base (outil serveur, hors RPC) : calcule les échéances attendues depuis le prix de la
 * mission (src/lib/prix.ts) et met à jour la table `echeance` sans toucher à ce qui est facturé ou réglé
 * (conception § Montants : « les échéances déjà facturées ne bougent pas ; le solde absorbe l'écart »).
 */
import { and, eq } from "drizzle-orm";
import { batch, db, newId, query, type Statement } from "../db/client";
import { echeance, lot, projet } from "../db/schema";
import { appliquer, commissionLot, syntheseProjet } from "../lib/prix";
import { CATEGORIE_MISSION } from "../lib/tresorerie";
import { baremeAcompte, missionPrix } from "./_commun";

export type EcheanceCible = {
  code: string;
  lotId: string | null;
  libelle: string;
  sens: "entree" | "sortie";
  payeurId: string | null;
  categorieId: string;
  jalon: string;
  ttc: number;
  ht: number;
};

const cle = (e: { code: string; lotId: string | null }) => `${e.code}|${e.lotId ?? ""}`;

/** Échéances attendues d'un projet, compte tenu de celles déjà facturées ou réglées (figées). */
export async function echeancesCibles(projetId: string) {
  const [p] = await db.select().from(projet).where(eq(projet.id, projetId));
  const m = await missionPrix(p.missionCode);
  const lots = await db.select().from(lot).where(and(eq(lot.projetId, projetId), eq(lot.archive, false)));
  const actuelles = await db.select().from(echeance).where(and(eq(echeance.projetId, projetId), eq(echeance.archive, false)));
  const figees = new Map(actuelles.filter((e) => e.statut !== "prevue").map((e) => [cle(e), e]));
  // Un acompte déjà facturé ou réglé est celui qu'on déduit des parts suivantes (pas celui du barème recalculé).
  const acompteFige = figees.get(cle({ code: "acompte", lotId: null }));
  const s = syntheseProjet(m, p, lots, acompteFige ? [{ plafondTtc: null, acompteTtc: acompteFige.ttc }] : await baremeAcompte());

  // Honoraires : une échéance par étape de l'échéancier ; les figées gardent leur montant, le solde absorbe l'écart.
  const categorieHonoraires = CATEGORIE_MISSION[m.code] ?? "autre_recette";
  const honoraires: EcheanceCible[] = s.echeancier.map((e) => ({ code: e.code, lotId: null, libelle: e.libelle, sens: "entree", payeurId: p.clientId, categorieId: categorieHonoraires, jalon: e.jalon, ttc: e.ttc, ht: e.ht }));
  const solde = honoraires.find((h) => h.code === "solde");
  for (const h of honoraires) {
    const f = figees.get(cle(h));
    if (f && h !== solde) {
      h.ttc = f.ttc;
      h.ht = f.ht;
    }
  }
  if (solde && !figees.has(cle(solde))) {
    const autresTtc = honoraires.filter((h) => h !== solde).reduce((x, h) => x + h.ttc, 0);
    const autresHt = honoraires.filter((h) => h !== solde).reduce((x, h) => x + h.ht, 0);
    solde.ttc = Math.max(0, s.honorairesTtc - autresTtc);
    solde.ht = Math.max(0, s.honorairesHt - autresHt);
  }
  const cibles: EcheanceCible[] = honoraires.filter((h) => h.ttc > 0 || figees.has(cle(h)));

  // Commissions : une par lot avec devis retenu, au démarrage des travaux, facturées à 20 %.
  for (const l of lots) {
    const ht = commissionLot(l);
    if (ht > 0) cibles.push({ code: "commission", lotId: l.id, libelle: `Commission lot ${l.numero} — ${l.corpsEtat}`, sens: "entree", payeurId: l.entrepriseId, categorieId: "commission_edb", jalon: "demarrage_travaux", ttc: appliquer(ht, 12_000), ht });
  }
  // Commission d'apport : sortante, à la réception (montant HT ; l'apporteur est souvent un particulier, sans TVA).
  if (p.apporteurId && s.apportHt > 0)
    cibles.push({ code: "apport", lotId: null, libelle: "Commission d'apport", sens: "sortie", payeurId: p.apporteurId, categorieId: "apport_affaires", jalon: m.avecTravaux ? "reception_travaux" : "remise_rapport", ttc: s.apportHt, ht: s.apportHt });
  return { cibles, actuelles };
}

/** Écart entre l'échéancier en base et l'échéancier attendu (aperçu avant mise à jour). */
export async function ecartEcheances(projetId: string) {
  const { cibles, actuelles } = await echeancesCibles(projetId);
  const parCle = new Map(actuelles.map((e) => [cle(e), e]));
  const creees = cibles.filter((c) => !parCle.has(cle(c)));
  const modifiees = cibles
    .filter((c) => {
      const e = parCle.get(cle(c));
      return e && e.statut === "prevue" && (e.ttc !== c.ttc || e.ht !== c.ht || e.libelle !== c.libelle || e.jalon !== c.jalon || e.payeurId !== c.payeurId);
    })
    .map((c) => ({ ...c, avantTtc: parCle.get(cle(c))!.ttc }));
  const cles = new Set(cibles.map(cle));
  // Les échéances saisies à la main (« manuelle:… », reprise comprise) ne relèvent pas du calcul : jamais retirées.
  const retirees = actuelles.filter((e) => e.statut === "prevue" && !e.code.startsWith("manuelle:") && !cles.has(cle(e)));
  return { creees, modifiees, retirees, cibles, actuelles };
}

/** Instructions qui alignent l'échéancier en base sur l'attendu (prévues seulement). */
export async function instructionsPlanification(projetId: string): Promise<Statement[]> {
  const { creees, modifiees, retirees, actuelles } = await ecartEcheances(projetId);
  const parCle = new Map(actuelles.map((e) => [cle(e), e]));
  const sts: Statement[] = [];
  for (const c of creees)
    sts.push({
      sql: `insert into echeance (id, projet_id, lot_id, code, libelle, sens, payeur_id, categorie_id, jalon, ttc, ht) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [newId(), projetId, c.lotId, c.code, c.libelle, c.sens, c.payeurId, c.categorieId, c.jalon, c.ttc, c.ht],
    });
  for (const c of modifiees)
    sts.push({
      sql: "update echeance set libelle = ?, payeur_id = ?, categorie_id = ?, jalon = ?, ttc = ?, ht = ? where id = ?",
      params: [c.libelle, c.payeurId, c.categorieId, c.jalon, c.ttc, c.ht, parCle.get(cle(c))!.id],
    });
  for (const e of retirees) sts.push({ sql: "update echeance set archive = 1 where id = ?", params: [e.id] });
  return sts;
}

/** Le projet a-t-il déjà un échéancier en base ? */
export async function aDesEcheances(projetId: string) {
  const [l] = await query("select 1 from echeance where projet_id = ? and archive = 0", [projetId]);
  return !!l;
}

/** Planifie (ou met à jour) l'échéancier d'un projet ; renvoie le nombre d'échéances touchées. */
export async function planifier(projetId: string) {
  const sts = await instructionsPlanification(projetId);
  if (sts.length) await batch(sts);
  return sts.length;
}
