/*
 * Lecture du « Plan de charge projets » du tableur (docs/analyse-tableurs.md § 1.3) : pour chaque projet, trois
 * lignes (« Signature devis », « Honoraires prestation », « Commission EDB ») et des montants HT placés dans des
 * colonnes-semaines (ligne 1 : « ANNEE 2 - T1 », ligne 2 : mois ; jusqu'à 5 semaines par mois). Fonctions pures.
 */
import { cellule, type Grille } from "./xlsx";
import { normaliser } from "./tableurs";

export type MontantPlanifie = { date: string; type: "signature" | "honoraires" | "commission"; ht: number };
export type ProjetPlanifie = {
  ligne: number;
  client: string;
  /** Mission entre parenthèses dans le nom (« MARTIN (AMO) ») : EXP, EAA, AMO, MOE, COU, AUD. */
  missionCode: string;
  travauxTtc: number | null;
  montants: MontantPlanifie[];
};

const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
const MISSIONS: [RegExp, string][] = [
  [/exp/, "EXP"],
  [/eaa/, "EAA"],
  [/amo/, "AMO"],
  [/moe/, "MOE"],
  [/courtage/, "COU"],
  [/audit/, "AUD"],
];

/**
 * Date de chaque colonne-semaine : l'année vient de « ANNEE N » (l'année 1 commence en juin de `anneeUn`), le mois de
 * la ligne 2, la semaine du rang de la colonne dans son mois (1er, 8, 15, 22, 29).
 */
export function datesDesColonnes(g: Grille, anneeUn: number) {
  const dates = new Map<number, string>();
  // Libellés fusionnés : le trimestre et le mois ne sont écrits que sur leur première colonne ; on les propage.
  let annee = 0;
  let m = -1;
  let rang = 0;
  const maxCol = Math.max(...[1, 2, 3].flatMap((l) => [...(g.get(l)?.keys() ?? [0])]), ...[...g.values()].flatMap((r) => [...r.keys()]));
  for (let c = 4; c <= maxCol; c++) {
    const lue = Number(/annee?\s*(\d+)/.exec(normaliser(cellule(g, 1, c)))?.[1]);
    if (lue) annee = lue;
    const nouveau = MOIS.indexOf(normaliser(cellule(g, 2, c)));
    if (nouveau >= 0) {
      m = nouveau;
      rang = 1;
    } else rang++;
    if (m < 0 || !annee || rang > 5) continue;
    // Exercice N = juin (année 1 + N − 1) → mai suivant.
    const a = anneeUn + annee - 1 + (m < 5 ? 1 : 0);
    dates.set(c, `${a}-${String(m + 1).padStart(2, "0")}-${String(Math.min(1 + 7 * (rang - 1), 28)).padStart(2, "0")}`);
  }
  return dates;
}

/** Projets du plan de charge (blocs de trois lignes), avec leurs montants datés. */
export function lirePlanDeCharge(g: Grille, anneeUn: number): ProjetPlanifie[] {
  const dates = datesDesColonnes(g, anneeUn);
  const projets = new Map<string, ProjetPlanifie>();
  for (const [ligne, cols] of g) {
    const nom = cols.get(1);
    const type = normaliser(cols.get(3) ?? null);
    const t = /signature/.test(type) ? "signature" : /honoraires/.test(type) ? "honoraires" : /commission/.test(type) ? "commission" : null;
    if (typeof nom !== "string" || !t) continue;
    const brut = nom.replace(/\s+/g, " ").trim();
    const mission = /\(([^)]+)\)\s*$/.exec(brut);
    const client = brut.replace(/\([^)]*\)\s*$/, "").trim();
    if (!mission || !client || /^nom (client|prenom)/i.test(client)) continue;
    const missionCode = MISSIONS.find(([r]) => r.test(normaliser(mission[1])))?.[1];
    if (!missionCode) continue;
    const cle = `${client}|${missionCode}`;
    const p = projets.get(cle) ?? { ligne, client, missionCode, travauxTtc: null, montants: [] };
    const travaux = cols.get(2);
    if (typeof travaux === "number" && travaux > 0) p.travauxTtc = Math.round(travaux * 100);
    for (const [c, v] of cols) {
      const date = dates.get(c);
      if (date && typeof v === "number" && v !== 0) p.montants.push({ date, type: t, ht: Math.round(v * 100) });
    }
    projets.set(cle, p);
  }
  return [...projets.values()].sort((a, b) => a.ligne - b.ligne);
}
