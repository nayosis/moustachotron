/*
 * Trésorerie par l'API : échéancier des projets (planification, figées, solde qui absorbe), facturation, règlement,
 * mouvements, charges récurrentes, vue prévisionnelle, prévu / réalisé. Conception § Trésorerie.
 */
import { describe, expect, test } from "bun:test";
import { aujourdhui } from "../src/lib/dates";
import { SUPER, serveurDeTest } from "./outils-serveur";

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
const erreur = async (nom: string, ...args: unknown[]) => (await appel(nom, args)).erreur;
const jour = (n: number) => {
  const d = new Date(`${aujourdhui()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
type Ech = { id: string; code: string; ttc: number; ht: number; statut: string; date: string | null; lotId: string | null };
const echeances = async (id: string) => (await ok("ficheProjet", id)).echeances as Ech[];
const par = (l: Ech[], code: string) => l.find((e) => e.code === code)!;

/** Projet AMO avec estimation de 60 000 € TTC, mission validée hier. */
async function projetValide(nom: string) {
  const id = await ok("creerProjet", { intitule: "Rénovation", missionCode: "AMO", origineCode: "site", nouveauClient: { nom } });
  const p = await ok("ficheProjet", id);
  await ok("majProjet", id, { estimationTtc: 6_000_000 }, p.modifieLe);
  await ok("fixerJalon", id, "validation_mission", { dateReelle: jour(-1) });
  return id;
}

describe("échéancier des projets", () => {
  test("mission validée : échéancier planifié sur l'estimation (acompte au barème, daté par son jalon)", async () => {
    const id = await projetValide("Famille Martin");
    const e = await echeances(id);
    expect(e.map((x) => x.code)).toEqual(["acompte", "signature_devis", "demarrage", "solde"]);
    // 60 000 € TTC → honoraires 9 000 € TTC ; acompte 750 € (≤ 75 k€) daté de la validation de la mission.
    expect(par(e, "acompte")).toMatchObject({ ttc: 75_000, date: jour(-1), statut: "prevue" });
    expect(e.reduce((x, y) => x + y.ttc, 0)).toBe(900_000);
  });

  test("devis validés : honoraires recalculés sur les devis, commissions par lot ; l'acompte facturé ne bouge pas, le solde absorbe", async () => {
    const id = await projetValide("Famille Roux");
    await ok("facturerEcheance", par(await echeances(id), "acompte").id, { numero: "FA-001", date: jour(0), ttc: 70_000 });
    const ent = await ok("creerContact", { type: "entreprise", nom: "Bâti Ouest", corpsEtat: "Maçonnerie" });
    const lot = await ok("creerLot", id, { corpsEtat: "Maçonnerie" });
    await ok("retenirDevis", await ok("creerDevis", lot, { entrepriseId: ent, date: jour(-2), montantTtc: 4_400_000 }));
    await ok("validerDevis", id, [lot], jour(0));
    const e = await echeances(id);
    // 44 000 € TTC → 6 600 € TTC d'honoraires ; acompte figé à 700 € ; 40 % = 2 640 − 700 = 1 940 € ; 40 % = 2 640 € ; solde = 6 600 − 700 − 1 940 − 2 640.
    expect(par(e, "acompte")).toMatchObject({ ttc: 70_000, statut: "facturee" });
    expect(par(e, "signature_devis").ttc).toBe(194_000);
    expect(par(e, "demarrage").ttc).toBe(264_000);
    expect(par(e, "solde").ttc).toBe(660_000 - 70_000 - 194_000 - 264_000);
    // Commission : 13 % de 40 000 € HT = 5 200 € HT, facturée 6 240 € TTC, au démarrage.
    expect(par(e, "commission")).toMatchObject({ lotId: lot, ht: 520_000, ttc: 624_000 });
    expect(await ok("apercuEcheances", id)).toEqual({ creees: [], modifiees: [], retirees: [] });
  });

  test("régler crée le mouvement et change le solde réel ; annuler le règlement le retire ; règlement futur refusé", async () => {
    const id = await projetValide("Famille Picard");
    const acompte = par(await echeances(id), "acompte");
    const solde = async () => (await ok("vueTresorerie")).soldeReel;
    const avant = await solde();
    expect(await erreur("reglerEcheance", acompte.id, { date: jour(2), mode: "virement" })).toContain("futur");
    const m = await ok("reglerEcheance", acompte.id, { date: jour(0), mode: "cheque" });
    expect(await solde()).toBe(avant + 75_000);
    const mouvements = await ok("listeMouvements", { mois: jour(0).slice(0, 7) });
    expect(mouvements.find((x: { id: string }) => x.id === m)).toMatchObject({ ttc: 75_000, categorieId: "hono_amo", source: "echeance", mode: "cheque" });
    // HT à la TVA des travaux (10 %), pas à 20 %.
    expect(mouvements.find((x: { id: string }) => x.id === m).ht).toBe(68_182);
    expect(await erreur("archiverMouvement", m)).toContain("annulez le règlement");
    await ok("annulerReglement", acompte.id);
    expect(await solde()).toBe(avant);
    expect(par(await echeances(id), "acompte").statut).toBe("prevue");
  });

  test("apporteur : commission d'apport sortante, à la réception", async () => {
    const a = await ok("creerContact", { type: "apporteur", nom: "Agence Duval" });
    const id = await ok("creerProjet", { intitule: "Maison", missionCode: "AMO", origineCode: "apporteur", apporteurId: a, nouveauClient: { nom: "Famille Hamon" } });
    await ok("majProjet", id, { estimationTtc: 1_100_000 });
    await ok("fixerJalon", id, "validation_mission", { dateReelle: jour(0) });
    // 11 000 € TTC → 1 650 € TTC d'honoraires, 1 500 € HT → apport 150 €.
    expect(par(await echeances(id), "apport")).toMatchObject({ ttc: 15_000, ht: 15_000 });
    expect((await ok("ficheProjet", id)).echeances.find((e: { code: string }) => e.code === "apport").sens).toBe("sortie");
  });
});

describe("mouvements et charges", () => {
  test("dépense saisie en positif, enregistrée en négatif ; HT selon la TVA ; justificatif rattaché", async () => {
    const f = new FormData();
    f.append("fichier", new File([new Uint8Array([255, 216, 255])], "ticket.jpg", { type: "image/jpeg" }));
    const fichier = await (await s.app.handle(new Request("http://local/api/fichiers", { method: "POST", body: f, headers: { "x-app": "1", cookie } }))).json();
    const id = await ok("creerMouvement", { date: jour(0), mode: "cb", objet: "Péage", categorieId: "transport", ttc: 1_200, tvaPb: 2000 }, [{ fichier: fichier.fichier, nom: "ticket.jpg" }]);
    const m = (await ok("listeMouvements", { recherche: "Péage" })).find((x: { id: string }) => x.id === id);
    expect(m).toMatchObject({ ttc: -1_200, ht: -1_000, tva: -200 });
    expect(m.justificatifs).toHaveLength(1);
    expect(await erreur("creerMouvement", { date: jour(0), mode: "cb", objet: "X", categorieId: "transport", ttc: -5 })).toContain("positif");
    // TVA et financement : signe saisi.
    const t = await ok("creerMouvement", { date: jour(0), mode: "prelevement", objet: "TVA", categorieId: "tva", ttc: -183_200 });
    expect((await ok("listeMouvements", { recherche: "TVA" })).find((x: { id: string }) => x.id === t)).toMatchObject({ ttc: -183_200, ht: -183_200 });
  });

  test("charge récurrente : comptée dans le prévisionnel ; catégorie de recette refusée", async () => {
    expect(await erreur("creerChargeRecurrente", { libelle: "X", categorieId: "hono_amo", montantTtc: 100, periodicite: "mensuelle", jour: 1, debut: jour(0) })).toContain("dépense");
    const avant = (await ok("vueTresorerie")).horizons.find((h: { jours: number }) => h.jours === 90);
    await ok("creerChargeRecurrente", { libelle: "Loyer", categorieId: "loyer", montantTtc: 92_000, tvaPb: 0, periodicite: "mensuelle", jour: 1, debut: jour(0) });
    const apres = (await ok("vueTresorerie")).horizons.find((h: { jours: number }) => h.jours === 90);
    // Trois mois → 3 loyers.
    expect(apres.charges - avant.charges).toBe(-3 * 92_000);
  });

  test("horizons réglables et date choisie ; ouverture de l'exercice dans le solde réel", async () => {
    await ok("majHorizons", [0, 30, 60]);
    const v = await ok("vueTresorerie", { dateChoisie: jour(200) });
    expect(v.horizons.map((h: { libelle: string }) => h.libelle).filter((l: string) => l !== "Fin du mois")).toEqual(["Aujourd'hui", "+1 mois", "+2 mois", "Date choisie"]);
    expect(v.horizons.at(-1).date).toBe(jour(200));
    const ex = v.exercice;
    const avant = v.soldeReel;
    await ok("majExercice", ex.id, { tresorerieOuverture: ex.tresorerieOuverture + 1_000_000 });
    expect((await ok("vueTresorerie")).soldeReel).toBe(avant + 1_000_000);
    expect(await erreur("majHorizons", [-1])).toContain("Horizons");
  });

  test("prévu / réalisé de l'exercice : réalisé par catégorie et par mois", async () => {
    const v = await ok("vueTresorerie");
    const synthese = await ok("syntheseExercice", v.exercice.id);
    const i = synthese.mois.indexOf(jour(0).slice(0, 7));
    const transport = synthese.lignes.find((l: { categorieId: string }) => l.categorieId === "transport");
    expect(transport.realise[i]).toBe(-1_000);
    expect(synthese.finDeMois).toHaveLength(12);
  });
});

describe("fin du mois", () => {
  test("le solde prévu en fin de mois est toujours proposé (sauf le dernier jour du mois)", async () => {
    const [a, m] = aujourdhui().split("-").map(Number);
    const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
    const h = (await ok("vueTresorerie")).horizons;
    if (fin > aujourdhui()) expect(h[1]).toMatchObject({ libelle: "Fin du mois", date: fin });
    else expect(h.some((x: { libelle: string }) => x.libelle === "Fin du mois")).toBe(false);
  });
});

describe("échéances saisies à la main", () => {
  test("hors calcul : jamais retirées par la mise à jour ; « à dater » tant que leur jalon n'est pas daté", async () => {
    const id = await projetValide("Famille Thomas");
    const m = await ok("ajouterEcheance", id, { libelle: "Reste à facturer (reprise)", sens: "entree", categorieId: "hono_amo", ht: 100_000, ttc: 110_000, jalon: "reception_travaux" });
    expect((await ok("apercuEcheances", id)).retirees).toEqual([]);
    expect((await ok("vueTresorerie")).aDater.some((e: { id: string }) => e.id === m)).toBe(true);
    await ok("fixerJalon", id, "reception_travaux", { datePrevue: jour(20) });
    const v = await ok("vueTresorerie");
    expect(v.aDater.some((e: { id: string }) => e.id === m)).toBe(false);
    expect((await echeances(id)).find((e) => e.id === m)).toMatchObject({ date: jour(20), ttc: 110_000 });
    expect(await erreur("ajouterEcheance", id, { libelle: "X", sens: "entree", categorieId: "hono_amo", ht: 200, ttc: 100, jalon: "reception_travaux" })).toContain("HT ≤ TTC");
  });
});
