/*
 * Charges récurrentes déduites du « Prévu » de la Synthèse Année N du tableur (montants HT par mois) et des
 * mouvements réels déjà repris (TTC, jour du prélèvement, fournisseur).
 *
 *   bun scripts/charges-depuis-synthese.ts "docs/sources/Tableau de gestion.xlsx" "Synthèse Année 3" 2026-12
 *
 * Affiche les charges proposées et écrit leur JSON (tableau de SaisieCharge) dans le fichier donné par --json, à
 * créer ensuite par l'API (creerChargeRecurrente : journalisé). Chaque ligne est découpée en périodes de montant
 * constant à partir du mois donné ; une période d'un seul mois devient une charge ponctuelle (annuelle, début = fin),
 * une période qui va jusqu'à la fin de l'exercice continue au-delà.
 * Les redevances sur CA et d'assurance ne sont pas reprises : l'application les calcule.
 */
import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Classeur, cellule } from "./reprise/xlsx";
import { categorieDeEntete, normaliser } from "./reprise/tableurs";

const [chemin, onglet = "Synthèse Année 3", depuis = "2026-12"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const iJson = process.argv.indexOf("--json");
const sortie = iJson > 0 ? process.argv[iJson + 1] : null;
const g = new Classeur(new Uint8Array(readFileSync(chemin))).grille(onglet);
if (!g) throw new Error(`Onglet introuvable : ${onglet}`);

// Colonnes « Prévu » : D, G, J… (juin à mai), une tous les 3.
const debutExercice = Number(onglet.match(/\d+/)?.[0] ?? 3) + 2023; // « Année 3 » → 2026
const mois = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(debutExercice, 5 + i, 1));
  return { mois: d.toISOString().slice(0, 7), col: 4 + 3 * i };
}).filter((m) => m.mois >= depuis);

const EXCLUES = new Set(["redevance_ca", "redevance_assurance", "apport_affaires", "travaux_local"]);
const categorie = (libelle: string) => {
  const l = normaliser(libelle);
  if (/cotisations/.test(l)) return "assurances";
  if (/fonciere/.test(l)) return "impots";
  return categorieDeEntete(libelle);
};

// Mouvements réels des 4 derniers mois : TVA réelle, jour habituel, fournisseur habituel.
const base = new Database(join(import.meta.dir, "..", "data", "donnees.db"), { readonly: true });
const reels = base
  .query<{ categorie_id: string; date: string; ttc: number; ht: number; tiers: string | null }, [string]>(
    "select categorie_id, date, ttc, ht, tiers from mouvement where archive = 0 and ttc < 0 and date >= ? order by date",
  )
  .all(`${mois[0].mois.slice(0, 4)}-0${Number(mois[0].mois.slice(5)) > 4 ? Number(mois[0].mois.slice(5)) - 4 : 1}-01`);
const infos = (cat: string) => {
  const r = reels.filter((x) => x.categorie_id === cat);
  const ttc = r.reduce((s, x) => s - x.ttc, 0),
    ht = r.reduce((s, x) => s - x.ht, 0);
  const plusGros = [...r].sort((a, b) => a.ttc - b.ttc)[0];
  const tiers = new Map<string, number>();
  for (const x of r) if (x.tiers) tiers.set(x.tiers, (tiers.get(x.tiers) ?? 0) + 1);
  return {
    ratio: ht > 0 ? ttc / ht : null,
    jour: plusGros ? Number(plusGros.date.slice(8, 10)) : 15,
    tiers: [...tiers].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
};
const tvaDefaut = new Map(base.query<{ id: string; tva_pb: number }, []>("select id, tva_pb from categorie").all().map((c) => [c.id, c.tva_pb]));
const dernierJour = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

type Charge = { libelle: string; tiers: string | null; categorieId: string; montantTtc: number; tvaPb: number; periodicite: "mensuelle" | "annuelle"; jour: number; debut: string; fin: string | null };
const charges: Charge[] = [];
for (let l = 20; l <= 70; l++) {
  const libelle = String(cellule(g, l, 3) ?? "");
  const cat = libelle ? categorie(libelle) : null;
  if (!cat || EXCLUES.has(cat)) continue;
  const valeurs = mois.map((m) => {
    const v = cellule(g, l, m.col);
    return typeof v === "number" ? Math.round(v * 100) : 0;
  });
  // Salaire du tableur = net + charges sociales : réparti selon les derniers mouvements réels.
  const parts: [string, number][] = cat === "salaire" ? (() => {
    const net = -reels.filter((x) => x.categorie_id === "salaire").reduce((s, x) => s + x.ttc, 0);
    const soc = -reels.filter((x) => x.categorie_id === "charges_sociales").reduce((s, x) => s + x.ttc, 0);
    return net + soc > 0 ? [["salaire", net / (net + soc)], ["charges_sociales", soc / (net + soc)]] : [["salaire", 1]];
  })() : [[cat, 1]];
  for (const [categorieId, part] of parts) {
    const info = infos(categorieId);
    // TVA réelle ramenée au taux légal le plus proche (les mouvements mêlent parfois des achats à des taux différents).
    const TAUX = [0, 550, 1000, 2000];
    const tvaPb = info.ratio != null ? TAUX.reduce((a, b) => (Math.abs(b - (info.ratio! - 1) * 10_000) < Math.abs(a - (info.ratio! - 1) * 10_000) ? b : a)) : (tvaDefaut.get(categorieId) ?? 2000);
    const nom = categorieId === "charges_sociales" ? "Charges sociales (part du salaire)" : libelle.replace(/\s+/g, " ").trim();
    // Périodes de montant constant.
    let i = 0;
    while (i < valeurs.length) {
      let j = i;
      while (j + 1 < valeurs.length && valeurs[j + 1] === valeurs[i]) j++;
      const ht = Math.round(valeurs[i] * part);
      if (ht > 0) {
        const ttc = Math.round((ht * (10_000 + tvaPb)) / 10_000);
        const jour = Math.min(info.jour, 28);
        const debut = `${mois[i].mois}-${String(jour).padStart(2, "0")}`;
        // Une valeur isolée (un seul mois) est ponctuelle, même en fin d'exercice ; une période de 2 mois ou plus qui va
        // jusqu'au bout de l'exercice continue au-delà.
        const ponctuelle = i === j;
        const finPeriode = j === valeurs.length - 1 ? null : dernierJour(mois[j].mois);
        charges.push({
          libelle: ponctuelle ? `${nom} (${mois[i].mois})` : nom,
          tiers: info.tiers,
          categorieId,
          montantTtc: ttc,
          tvaPb,
          periodicite: ponctuelle ? "annuelle" : "mensuelle",
          jour,
          debut,
          fin: ponctuelle ? debut : finPeriode,
        });
      }
      i = j + 1;
    }
  }
}
const e = (c: number) => (c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2 }) + " €";
for (const c of charges) console.log(`${c.libelle.padEnd(48)} ${c.categorieId.padEnd(20)} ${e(c.montantTtc).padStart(12)}  TVA ${c.tvaPb / 100}%  le ${c.jour}  ${c.periodicite === "annuelle" ? "une fois" : "chaque mois"}  ${c.debut} → ${c.fin ?? "…"}  ${c.tiers ?? ""}`);
const mensuel = charges.filter((c) => c.periodicite === "mensuelle" && !c.fin).reduce((s, c) => s + c.montantTtc, 0);
console.log(`\n${charges.length} charges ; environ ${e(mensuel)} TTC par mois en régime courant.`);
if (sortie) writeFileSync(sortie, JSON.stringify(charges, null, 2));
