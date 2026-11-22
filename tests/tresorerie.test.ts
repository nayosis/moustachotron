/*
 * Prévisionnel de trésorerie (src/lib/tresorerie.ts) : règles du skill `tresorerie` et de la conception.
 */
import { describe, expect, test } from "bun:test";
import { ajouterMois, dateHorizon, fluxPrevus, jourDuMois, libelleHorizon, occurrences, projection, serie, type ChargePrev, type Contexte, type EcheancePrev } from "../src/lib/tresorerie";

const reglages = { tvaJour: 25, redevanceCaPb: 500, redevanceCaJour: 15, redevanceAssurancePb: { COU: 50, AMO: 300, MOE: 750 } };
const loyer: ChargePrev = { id: "l", libelle: "Loyer", categorieId: "loyer", montantTtc: 92_000, tvaPb: 0, periodicite: "mensuelle", jour: 1, debut: "2026-01-01", fin: null };
const echeance = (x: Partial<EcheancePrev>): EcheancePrev => ({
  id: "e",
  libelle: "Démarrage",
  projetLibelle: "Martin",
  date: "2026-12-02",
  sens: "entree",
  ttc: 110_000,
  ht: 100_000,
  categorieId: "hono_amo",
  statut: "prevue",
  probaPb: 10_000,
  ...x,
});
const ctx = (x: Partial<Contexte> = {}): Contexte => ({ aujourdhui: "2026-11-22", soldeReel: 3_000_000, echeances: [], charges: [], realise: {}, reglages, ...x });

describe("dates", () => {
  test("jour 31 ramené au dernier jour des mois courts ; +1 mois du 31 janvier = 28 février", () => {
    expect(jourDuMois(2027, 1, 31)).toBe("2027-02-28");
    expect(jourDuMois(2028, 1, 31)).toBe("2028-02-29");
    expect(ajouterMois("2027-01-31", 1)).toBe("2027-02-28");
  });

  test("horizons : 0 = aujourd'hui, multiples de 30 en mois calendaires", () => {
    expect(libelleHorizon(0)).toBe("Aujourd'hui");
    expect(libelleHorizon(90)).toBe("+3 mois");
    expect(libelleHorizon(45)).toBe("+45 j");
    expect(dateHorizon("2026-11-22", 30)).toBe("2026-12-22");
    expect(dateHorizon("2026-11-22", 45)).toBe("2027-01-06");
  });

  test("occurrences d'une charge : mensuelle, trimestrielle, bornée par sa fin", () => {
    expect(occurrences(loyer, "2026-11-22", "2027-02-22")).toEqual(["2026-12-01", "2027-01-01", "2027-02-01"]);
    expect(occurrences({ ...loyer, periodicite: "trimestrielle", debut: "2026-01-15", jour: 15 }, "2026-11-22", "2027-06-30")).toEqual(["2027-01-15", "2027-04-15"]);
    expect(occurrences({ ...loyer, fin: "2026-12-31" }, "2026-11-22", "2027-02-22")).toEqual(["2026-12-01"]);
  });
});

describe("prévisionnel", () => {
  test("horizon aujourd'hui = solde réel", () => {
    expect(projection(ctx({ charges: [loyer] }), "2026-11-22").solde).toBe(3_000_000);
  });

  test("échéances et charges de ]aujourd'hui, horizon] ; échéances en retard et réglées exclues", () => {
    const c = ctx({
      charges: [loyer],
      echeances: [echeance({}), echeance({ id: "r", date: "2026-11-10" }), echeance({ id: "x", statut: "reglee", date: "2026-12-05" }), echeance({ id: "s", sens: "sortie", ttc: 30_000, ht: 30_000, categorieId: "apport_affaires", date: "2026-12-10" })],
    });
    const p = projection(c, "2026-12-22");
    const echeances = p.flux.filter((f) => f.type === "echeance").map((f) => f.montant);
    expect(echeances).toEqual([110_000, -30_000]);
    expect(p.flux.filter((f) => f.type === "charge").map((f) => f.date)).toEqual(["2026-12-01"]);
  });

  test("TVA du mois payée le mois suivant : collectée sur les encaissements − déductible des charges ; crédit = rien à payer", () => {
    // Réalisé de novembre : 1 000 € de TVA nette ; prévu en décembre : encaissement 1 100 € TTC à 10 % (100 € de TVA).
    const c = ctx({ realise: { "2026-11": { reseauHt: 0, honorairesHtParCategorie: {}, tvaNette: 100_000 } }, echeances: [echeance({ categorieId: "expertise" })] });
    const tva = fluxPrevus(c, "2027-01-31").filter((f) => f.type === "tva");
    expect(tva.map((f) => [f.date, f.montant])).toEqual([
      ["2026-12-25", -100_000],
      ["2027-01-25", -10_000],
    ]);
    const credit = ctx({ realise: { "2026-11": { reseauHt: 0, honorairesHtParCategorie: {}, tvaNette: -50_000 } } });
    expect(fluxPrevus(credit, "2026-12-31").filter((f) => f.type === "tva")).toEqual([]);
  });

  test("redevances du réseau : 5 % du CA réseau HT du mois et redevance assurance (3 % AMO), payées le 15 du mois suivant, à 20 %", () => {
    const c = ctx({ realise: { "2026-11": { reseauHt: 1_000_000, honorairesHtParCategorie: { hono_amo: 1_000_000 }, tvaNette: 0 } } });
    const r = fluxPrevus(c, "2026-12-31").filter((f) => f.type === "redevance");
    expect(r.map((f) => [f.date, f.categorieId, f.montant, f.ht])).toEqual([
      ["2026-12-15", "redevance_ca", -60_000, -50_000],
      ["2026-12-15", "redevance_assurance", -36_000, -30_000],
    ]);
  });

  test("mode pondéré : une échéance à 50 % compte pour moitié", () => {
    const c = ctx({ echeances: [echeance({ probaPb: 5000, categorieId: "expertise" })] });
    const solde = (pondere: boolean) => projection({ ...c, pondere }, "2026-12-03").solde;
    expect(solde(false) - 3_000_000).toBe(110_000);
    expect(solde(true) - 3_000_000).toBe(55_000);
  });

  test("courbe : un point par jour, cumul des flux", () => {
    const s = serie(ctx({ charges: [loyer] }), "2026-12-02");
    expect(s).toHaveLength(11);
    expect(s[0]).toEqual({ date: "2026-11-22", solde: 3_000_000 });
    expect(s.at(-1)).toEqual({ date: "2026-12-02", solde: 3_000_000 - 92_000 });
  });
});

describe("mouvements datés dans le futur", () => {
  test("pas dans le solde réel, mais comptés à leur date dans le prévisionnel", () => {
    const c = ctx({ mouvementsFuturs: [{ date: "2026-11-30", ttc: -78_000, ht: -65_000, categorieId: "pub_mutualisee", libelle: "Publicité mutualisée" }] });
    expect(projection(c, "2026-11-22").solde).toBe(3_000_000);
    expect(projection(c, "2026-11-30").solde).toBe(3_000_000 - 78_000);
  });
});

describe("TVA déjà payée", () => {
  test("un paiement de TVA enregistré le mois suivant supprime l'estimation de ce mois", () => {
    const realise = { "2026-10": { reseauHt: 0, honorairesHtParCategorie: {}, tvaNette: 55_406 }, "2026-11": { reseauHt: 0, honorairesHtParCategorie: {}, tvaNette: 0, tvaPayee: -63_900 } };
    expect(fluxPrevus(ctx({ realise }), "2026-12-31").filter((f) => f.type === "tva")).toEqual([]);
    const sansPaiement = { "2026-10": realise["2026-10"] };
    expect(fluxPrevus(ctx({ realise: sansPaiement }), "2026-11-30").filter((f) => f.type === "tva").map((f) => f.montant)).toEqual([-55_406]);
  });
});
