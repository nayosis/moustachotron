/*
 * Relevé bancaire : lecture des CSV des banques (src/lib/releve.ts), propositions et import (src/data/releve.ts).
 */
import { describe, expect, test } from "bun:test";
import { aujourdhui } from "../src/lib/dates";
import { cleReleve, lireNombre, lireReleve, modeDuLibelle, motsCles } from "../src/lib/releve";
import { SUPER, serveurDeTest } from "./outils-serveur";

describe("lecture du CSV", () => {
  test("format débit / crédit avec titre avant les en-têtes, séparateur « ; », nombres à la française", () => {
    const csv = [
      "Compte courant n° 00000000000",
      "Date d'opération;Date de valeur;Débit;Crédit;Libellé;Solde",
      '03/10/2026;03/10/2026;;568,91;"VIR SEPA FCH MARTIN";29 471,38',
      "05/10/2026;05/10/2026;-1 832,00;;PRLV SEPA DGFIP TVA;27 639,38",
      "06/10/2026;06/10/2026;12,50;;CB PEAGE PONT DE RE 04/10;27 626,88",
    ].join("\r\n");
    expect(lireReleve(csv).lignes).toEqual([
      { date: "2026-10-03", libelle: "VIR SEPA FCH MARTIN", montant: 56_891 },
      { date: "2026-10-05", libelle: "PRLV SEPA DGFIP TVA", montant: -183_200 },
      { date: "2026-10-06", libelle: "CB PEAGE PONT DE RE 04/10", montant: -1_250 },
    ]);
  });

  test("format « Montant » signé, séparateur « , », dates ISO ; colonnes manquantes signalées", () => {
    expect(lireReleve("Date,Libelle,Montant\n2026-10-01,LOYER,-920.00\n2026-10-02,REMISE CHEQUE,500").lignes).toEqual([
      { date: "2026-10-01", libelle: "LOYER", montant: -92_000 },
      { date: "2026-10-02", libelle: "REMISE CHEQUE", montant: 50_000 },
    ]);
    expect(lireReleve("Jour;Texte\n01/10/2026;X").erreur).toContain("date");
    expect(lireNombre("1.234,56")).toBe(123_456);
    expect(lireNombre("")).toBeNull();
  });

  test("mots-clés du tiers, mode deviné, clé d'import stable", () => {
    expect(motsCles("PRLV SEPA URSSAF POITOU 123456")).toBe("urssaf poitou");
    expect(motsCles("CB SUPER U 15/10")).toBe("super");
    expect(modeDuLibelle("PRLV SEPA EDF")).toBe("prelevement");
    expect(modeDuLibelle("CB PEAGE")).toBe("cb");
    const l = { date: "2026-10-01", libelle: "LOYER", montant: -92_000 };
    expect(cleReleve(l)).toBe(cleReleve({ ...l }));
    expect(cleReleve(l, 1)).not.toBe(cleReleve(l));
  });
});

describe("import par l'API", async () => {
  const s = await serveurDeTest();
  const { cookie } = await s.connexion(SUPER.email, SUPER.motDePasse);
  const appel = async (nom: string, args: unknown[]) => {
    const r = await s.rpc(nom, args, cookie);
    const corps = await r.json();
    return { statut: r.status, resultat: corps.resultat, erreur: corps.erreur as string | undefined };
  };
  const ok = async (nom: string, ...args: unknown[]) => {
    const r = await appel(nom, args);
    if (r.statut !== 200) throw new Error(`${nom} : ${r.statut} ${r.erreur}`);
    return r.resultat;
  };
  const jour = (n: number) => {
    const d = new Date(`${aujourdhui()}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  test("propositions : échéance encaissée, charge récurrente (mot-clé), catégorie apprise ; import rejouable sans doublon", async () => {
    // Une échéance d'acompte de 750 € (projet AMO, 60 000 € estimés, mission validée).
    const id = await ok("creerProjet", { intitule: "Maison", missionCode: "AMO", origineCode: "site", nouveauClient: { nom: "Famille Garnier" } });
    await ok("majProjet", id, { estimationTtc: 6_000_000 });
    await ok("fixerJalon", id, "validation_mission", { dateReelle: jour(-5) });
    await ok("creerChargeRecurrente", { libelle: "Charges sociales", categorieId: "charges_sociales", montantTtc: 68_000, tvaPb: 0, periodicite: "mensuelle", jour: 16, debut: jour(-60), motCle: "URSSAF" });
    await ok("creerMouvement", { date: jour(-40), mode: "cb", objet: "CB SUPER U 02/09", categorieId: "agence", ttc: 2_350, tvaPb: 550 });

    const lignes = [
      { date: jour(-1), libelle: "VIR SEPA FAMILLE GARNIER", montant: 75_000 },
      { date: jour(-1), libelle: "PRLV SEPA URSSAF POITOU", montant: -71_200 },
      { date: jour(-1), libelle: "CB SUPER U 20/11", montant: -1_890 },
      { date: jour(-1), libelle: "CB BOULANGERIE", montant: -650 },
    ];
    const p = await ok("analyserReleve", lignes);
    expect(p[0].echeance?.libelle).toContain("Acompte");
    expect(p[1]).toMatchObject({ categorieId: "charges_sociales", raison: "Charge récurrente « Charges sociales »" });
    expect(p[2]).toMatchObject({ categorieId: "agence", raison: "Comme les fois précédentes" });
    expect(p[3].categorieId).toBeNull();

    // Une ligne sans catégorie bloque tout l'import (jamais à moitié).
    const aImporter = p.map((x: { cle: string; date: string; libelle: string; montant: number; categorieId: string | null; chargeRecurrenteId: string | null; echeance: { id: string } | null }) => ({
      cle: x.cle, date: x.date, libelle: x.libelle, montant: x.montant, categorieId: x.categorieId, chargeRecurrenteId: x.chargeRecurrenteId, echeanceId: x.echeance?.id ?? null,
    }));
    expect((await appel("importerReleve", [aImporter])).erreur).toContain("Choisissez une catégorie");
    aImporter[3].categorieId = "hono_amo";
    expect((await appel("importerReleve", [aImporter])).erreur).toContain("bon sens");
    aImporter[3].categorieId = "restauration";
    expect(await ok("importerReleve", aImporter)).toEqual({ crees: 4, ignorees: 0 });

    // L'échéance est réglée par la ligne du relevé.
    const acompte = (await ok("ficheProjet", id)).echeances.find((e: { code: string }) => e.code === "acompte");
    expect(acompte.statut).toBe("reglee");
    // Rejouer le même relevé : tout est reconnu comme déjà importé.
    const encore = await ok("analyserReleve", lignes);
    expect(encore.every((x: { deja: boolean }) => x.deja)).toBe(true);
    expect(await ok("importerReleve", aImporter)).toEqual({ crees: 0, ignorees: 4 });
  });

  test("doublon probable : un mouvement saisi à la main de même montant à ± 3 jours est signalé", async () => {
    await ok("creerMouvement", { date: jour(-2), mode: "cb", objet: "Péage", categorieId: "transport", ttc: 1_250, tvaPb: 2000 });
    const [p] = await ok("analyserReleve", [{ date: jour(-1), libelle: "CB PEAGE ASF", montant: -1_250 }]);
    expect(p.doublon?.objet).toBe("Péage");
  });
});
