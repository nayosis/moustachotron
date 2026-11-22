/*
 * Règles de prix (conception § Montants d'un projet, décidées le 22/11/2026) : fonctions pures de src/lib/prix.ts.
 * Montants en centimes, taux en points de base.
 */
import { describe, expect, test } from "bun:test";
import { acompte, commissionLot, echeancier, honoraires, syntheseProjet, type EtapeEcheancier, type MissionPrix } from "../src/lib/prix";

const ECH_AMO: EtapeEcheancier[] = [
  { code: "acompte", libelle: "Acompte", type: "acompte", jalon: "validation_mission" },
  { code: "signature_devis", libelle: "40 %", type: "part", partPb: 4000, deduireAcompte: true, jalon: "validation_devis" },
  { code: "demarrage", libelle: "40 %", type: "part", partPb: 4000, jalon: "demarrage_travaux" },
  { code: "solde", libelle: "Solde", type: "solde", jalon: "reception_travaux" },
];
const AMO: MissionPrix = { mode: "pourcentage", tauxPb: 1500, forfaitTtc: null, tvaPb: null, avecAcompte: true, echeancier: ECH_AMO };
const COURTAGE: MissionPrix = {
  mode: "pourcentage",
  tauxPb: 600,
  forfaitTtc: null,
  tvaPb: null,
  avecAcompte: true,
  echeancier: [ECH_AMO[0], { code: "solde", libelle: "Solde", type: "solde", jalon: "validation_devis" }],
};
const EAA: MissionPrix = { mode: "forfait", tauxPb: null, forfaitTtc: 19900, tvaPb: 2000, avecAcompte: false, echeancier: [{ code: "solde", libelle: "Rapport", type: "solde", jalon: "remise_rapport" }] };
const SANS: { tauxPb: null; forfaitTtc: null; tauxApportPb: null } = { tauxPb: null, forfaitTtc: null, tauxApportPb: null };
const lot = (montantTtc: number, tvaPb = 1000, commissionPb = 1300) => ({ montantTtc, tvaPb, commissionPb });

describe("honoraires", () => {
  test("le client paie le taux sur le TTC ; le HT suit la TVA des travaux (100 000 € TTC à 10 % → 15 000 € TTC, 13 636,36 € HT)", () => {
    expect(honoraires(AMO, SANS, [lot(10_000_000)])).toEqual({ ttc: 1_500_000, ht: 1_363_636 });
  });

  test("lots à des TVA différentes : HT calculé lot par lot", () => {
    // 11 000 € TTC à 10 % et 10 550 € TTC à 5,5 % → honoraires 1 650 + 1 582,50 TTC ; HT 1 500 + 1 500.
    expect(honoraires(AMO, SANS, [lot(1_100_000, 1000), lot(1_055_000, 550)])).toEqual({ ttc: 323_250, ht: 300_000 });
  });

  test("taux du projet (12,75 %) et forfait du projet remplacent ceux de la mission ; lots sans devis retenu ignorés", () => {
    expect(honoraires(AMO, { ...SANS, tauxPb: 1275 }, [lot(1_100_000), { montantTtc: null, tvaPb: 1000, commissionPb: 1300 }]).ttc).toBe(140_250);
    // Forfait sur une mission en % : HT à la TVA moyenne des travaux.
    expect(honoraires(AMO, { ...SANS, forfaitTtc: 220_000 }, [lot(1_100_000)])).toEqual({ ttc: 220_000, ht: 200_000 });
  });

  test("forfait EAA 199 € TTC à 20 % → 165,83 € HT", () => {
    expect(honoraires(EAA, SANS, [])).toEqual({ ttc: 19_900, ht: 16_583 });
  });

  test("courtage : 6 % du TTC des devis validés", () => {
    expect(honoraires(COURTAGE, SANS, [lot(5_000_000)]).ttc).toBe(300_000);
  });
});

describe("acompte et échéancier", () => {
  test("barème : < 20 k€ 500 € ; jusqu'à 75 k€ 750 € ; jusqu'à 100 k€ 1 000 € ; au-delà 1 500 €", () => {
    expect(acompte(1_999_999)).toBe(50_000);
    expect(acompte(2_000_000)).toBe(75_000);
    expect(acompte(7_500_000)).toBe(75_000);
    expect(acompte(7_500_001)).toBe(100_000);
    expect(acompte(10_000_000)).toBe(100_000);
    expect(acompte(10_000_001)).toBe(150_000);
  });

  test("AMO : acompte, 40 % à la signature des devis acompte déduit, 40 % au démarrage, solde ; la somme tombe juste", () => {
    // 13 647,62 € TTC à 10 % → honoraires 2 047,14 € TTC.
    const e = echeancier(AMO, SANS, [lot(1_364_762)]);
    expect(e.map((l) => [l.code, l.ttc])).toEqual([
      ["acompte", 50_000],
      ["signature_devis", 31_886],
      ["demarrage", 81_886],
      ["solde", 40_942],
    ]);
    expect(e.reduce((s, l) => s + l.ttc, 0)).toBe(204_714);
    expect(e.reduce((s, l) => s + l.ht, 0)).toBe(honoraires(AMO, SANS, [lot(1_364_762)]).ht);
    // Relevé réel : acompte de 500 € TTC = 454,55 € HT (TVA des travaux).
    expect(e[0].ht).toBe(45_455);
  });

  test("acompte plus grand que les 40 % : le reste se déduit de l'échéance suivante", () => {
    // 5 000 € TTC → honoraires 750 € TTC ; acompte 500 € ; 40 % = 300 € → 0, reste 200 € à déduire du démarrage.
    const e = echeancier(AMO, SANS, [lot(500_000)]);
    expect(e.map((l) => l.ttc)).toEqual([50_000, 0, 10_000, 15_000]);
  });

  test("courtage : acompte puis solde à la signature des devis", () => {
    expect(echeancier(COURTAGE, SANS, [lot(5_000_000)]).map((l) => [l.code, l.ttc])).toEqual([
      ["acompte", 75_000],
      ["solde", 225_000],
    ]);
  });

  test("sans honoraires (aucun devis retenu) : pas d'échéancier", () => {
    expect(echeancier(AMO, SANS, [])).toEqual([]);
  });
});

describe("commissions et apport", () => {
  test("commission de l'entreprise : 13 % du HT du lot", () => {
    expect(commissionLot(lot(1_100_000))).toBe(130_000);
  });

  test("commission d'apport : 10 % des honoraires HT", () => {
    const s = syntheseProjet(AMO, { ...SANS, tauxApportPb: 1000 }, [lot(10_000_000)]);
    expect(s.apportHt).toBe(136_364);
    expect(s.commissionsHt).toBe(1_181_818);
  });
});
