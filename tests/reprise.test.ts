/*
 * Reprise des tableurs (scripts/reprise/) sur un petit classeur fabriqué : en-têtes fusionnés (le libellé n'est que
 * sur la première colonne), « Totaux: », dépenses en négatif, TVA et financement signés, contrôle du pied.
 */
import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { Classeur } from "../scripts/reprise/xlsx";
import { categorieDeEntete, lireOngletMensuel, moisDeOnglet } from "../scripts/reprise/tableurs";

/** Classeur minimal : un onglet, cellules « A1 » → valeur (texte en ligne ou nombre). */
function classeur(nom: string, cellules: Record<string, string | number>) {
  const lignes = new Map<number, string[]>();
  for (const [ref, v] of Object.entries(cellules)) {
    const l = Number(/\d+/.exec(ref)![0]);
    const xml = typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v.replace(/&/g, "&amp;")}</t></is></c>`;
    lignes.set(l, [...(lignes.get(l) ?? []), xml]);
  }
  const feuille = `<worksheet><sheetData>${[...lignes].sort((a, b) => a[0] - b[0]).map(([l, c]) => `<row r="${l}">${c.join("")}</row>`).join("")}</sheetData></worksheet>`;
  return new Classeur(
    zipSync({
      "xl/workbook.xml": strToU8(`<workbook><sheets><sheet name="${nom}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`),
      "xl/worksheets/sheet1.xml": strToU8(feuille),
    }),
  );
}

describe("reprise des tableurs", () => {
  test("mois de l'onglet et catégories reconnues par leur libellé", () => {
    expect(moisDeOnglet("Août 2025")).toBe("2025-08");
    expect(moisDeOnglet("Synthèse Année 3")).toBeNull();
    expect(categorieDeEntete("Hono. AMO")).toBe("hono_amo");
    expect(categorieDeEntete("Commission d'apport d'affaires")).toBe("apport_affaires");
    expect(categorieDeEntete("Commission / EDB")).toBe("commission_edb");
    expect(categorieDeEntete("Rémunération", "Charges")).toBe("charges_sociales");
    expect(categorieDeEntete("Rémunération", "Net à payer")).toBe("salaire");
  });

  test("onglet mensuel : TTC apparié à son H.T., sous-colonnes fusionnées, totaux, contrôle du pied", () => {
    const c = classeur("Octobre 2026", {
      G3: "Hono. AMO", G4: "H.T.", H4: "TTC",
      I3: "TVA", I4: "TVA",
      J3: "Loyer", J4: "H.T.", K4: "TTC",
      L3: "Rémunération", L4: "Charges", M4: "Net à payer",
      // 03/10/2026 = 46298 (date Excel)
      A5: 46298, B5: "FCH", E5: "Virement", F5: "MARTIN - Démarrage", G5: 1000, H5: 1100,
      A6: 46299, B6: "SCI", E6: "Prélèvement", F6: "Loyer", J6: 920, K6: 920,
      A7: 46300, B7: "DGFIP", E7: "Prélèvement", F7: "TVA", I7: -300,
      A8: 46301, F8: "Salaire", L8: 1500, M8: 2000,
      F10: "Totaux:", G10: 1000,
      F20: "Trésorerie disponible en début de mois:", G20: 10_000,
      F21: "Trésorerie disponible en fin de mois:", G21: 6_380,
    });
    const r = lireOngletMensuel(c.grille("Octobre 2026")!, "Octobre 2026")!;
    expect(r.inconnues).toEqual([]);
    expect(r.mouvements.map((m) => [m.date, m.categorieId, m.ttc, m.ht, m.mode])).toEqual([
      ["2026-10-03", "hono_amo", 110_000, 100_000, "virement"],
      ["2026-10-04", "loyer", -92_000, -92_000, "prelevement"],
      ["2026-10-05", "tva", -30_000, -30_000, "prelevement"],
      ["2026-10-06", "charges_sociales", -150_000, -150_000, "autre"],
      ["2026-10-06", "salaire", -200_000, -200_000, "autre"],
    ]);
    // Somme reprise = fin − début du tableur.
    expect(r.mouvements.reduce((s, m) => s + m.ttc, 0)).toBe(r.fin! - r.debut!);
    // Clés stables : rejouer la reprise ne crée pas de doublon.
    expect(new Set(r.mouvements.map((m) => m.cle)).size).toBe(5);
  });
});

describe("dates hors du mois de l'onglet", () => {
  test("ramenées dans le mois de l'onglet (même jour, borné à la fin du mois), date d'origine dans l'objet", () => {
    const c = classeur("Novembre 2026", {
      G3: "Loyer", G4: "H.T.", H4: "TTC",
      // 05/10/2026 = 46300 ; 31/05/2030 = 47634.
      A5: 46300, F5: "Loyer", G5: 920, H5: 920,
      A6: 47634, F6: "Loyer bis", G6: 10, H6: 10,
      F8: "Total:",
    });
    const r = lireOngletMensuel(c.grille("Novembre 2026")!, "Novembre 2026")!;
    expect(r.mouvements.map((m) => [m.date, m.objet])).toEqual([
      ["2026-11-05", "Loyer (date du tableur : 05/10/2026)"],
      ["2026-11-30", "Loyer bis (date du tableur : 31/05/2030)"],
    ]);
    expect(r.datesCorrigees).toBe(2);
  });
});
