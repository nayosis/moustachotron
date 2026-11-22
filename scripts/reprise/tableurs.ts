/*
 * Reprise du « Tableau de gestion » (docs/analyse-tableurs.md § 1.1, skill `tresorerie` § Import) : chaque onglet
 * mensuel devient une liste de mouvements. Les colonnes changent d'un exercice à l'autre : on les reconnaît par
 * leur libellé d'en-tête (lignes 2 à 4), pas par leur position. Fonctions pures (testées sans le vrai classeur).
 */
import { cellule, dateExcel, type Grille, type Valeur } from "./xlsx";

export type MouvementRepris = {
  cle: string;
  date: string;
  tiers: string | null;
  reference: string | null;
  dateEmission: string | null;
  mode: "virement" | "prelevement" | "cb" | "cheque" | "especes" | "autre";
  objet: string;
  categorieId: string;
  ht: number;
  tva: number;
  ttc: number;
};

export type OngletRepris = {
  onglet: string;
  mois: string;
  mouvements: MouvementRepris[];
  /** Trésorerie de début et de fin de mois lues en pied d'onglet (centimes), pour contrôle. */
  debut: number | null;
  fin: number | null;
  /** En-têtes de colonnes non reconnus (avec des montants) : à ajouter à la table de correspondance. */
  inconnues: string[];
  /** Lignes datées hors du mois de l'onglet, ramenées dans ce mois. */
  datesCorrigees: number;
};

const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

export const normaliser = (s: Valeur) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** « Octobre 2026 » → « 2026-10 » (null si l'onglet n'est pas un mois). */
export function moisDeOnglet(nom: string) {
  const m = /^(\S+)\s+(\d{4})$/.exec(normaliser(nom));
  if (!m) return null;
  const i = MOIS.indexOf(m[1]);
  return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, "0")}`;
}

/** Catégories de recettes (montants positifs) ; TVA et financement gardent leur signe ; le reste est une dépense. */
const RECETTES = new Set(["expertise", "apport_recu", "hono_amo", "hono_moe", "courtage", "eaa", "commission_edb", "audit", "autre_recette"]);
const SIGNEES = new Set(["tva", "financement"]);

/**
 * Catégorie d'une colonne d'après ses en-têtes : libellé (ligne 3), précision (ligne 4, « Charges », « Net à payer »).
 * L'ordre compte : les libellés les plus précis d'abord.
 */
export function categorieDeEntete(libelle: Valeur, precision: Valeur = null): string | null {
  const l = normaliser(libelle);
  const p = normaliser(precision);
  const regles: [RegExp, string][] = [
    [/apport d.affaire/, "apport_affaires"],
    [/commission/, "commission_edb"],
    [/hono.*amo/, "hono_amo"],
    [/hono.*moe/, "hono_moe"],
    [/^eaa/, "eaa"],
    [/courtage/, "courtage"],
    [/audit/, "audit"],
    [/expertise/, "expertise"],
    [/^tva/, "tva"],
    [/financement/, "financement"],
    [/frais de franchise/, "franchise_redevance"],
    [/publicite mutualisee/, "pub_mutualisee"],
    [/publicite nationale/, "pub_nationale"],
    [/redevance sur ca/, "redevance_ca"],
    [/redevance.*assurance/, "redevance_assurance"],
    [/formation/, "formation"],
    [/publicite locale/, "pub_locale"],
    [/frais bancaire/, "frais_bancaires"],
    [/emprunt/, "emprunt"],
    [/comptabilite/, "comptable"],
    [/frais de societe/, "frais_societe"],
    [/loyer/, "loyer"],
    [/travaux/, "travaux_local"],
    [/^edf|electricite/, "energie"],
    [/^rese|^eau/, "eau"],
    [/telephonie/, "telephonie"],
    [/^loa/, "loa"],
    [/carburant/, "carburant"],
    [/transport/, "transport"],
    [/^assurance/, "assurances"],
    [/mutuelle/, "mutuelle"],
    [/agence/, "agence"],
    [/bureautique/, "bureautique"],
    [/restauration|hebergement/, "restauration"],
    [/adhesion/, "adhesions"],
    [/informatique/, "informatique"],
    [/logiciel/, "logiciels"],
    [/outillage/, "outillage"],
    [/impot|taxe|cfe/, "impots"],
  ];
  if (/remuneration|salaire/.test(l)) return /charge/.test(p) ? "charges_sociales" : "salaire";
  return regles.find(([r]) => r.test(l))?.[1] ?? null;
}

const MODES: [RegExp, MouvementRepris["mode"]][] = [
  [/prelev/, "prelevement"],
  [/virement|vir/, "virement"],
  [/cb|carte/, "cb"],
  [/cheque|chq/, "cheque"],
  [/espece/, "especes"],
];
const mode = (v: Valeur) => MODES.find(([r]) => r.test(normaliser(v)))?.[1] ?? "autre";

/** Date d'une cellule (date Excel ou texte « jj/mm/aaaa ») ; null si illisible. */
function lireDate(v: Valeur): string | null {
  if (typeof v === "number" && v > 20_000 && v < 80_000) return dateExcel(v);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const a = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

const centimes = (v: Valeur) => (typeof v === "number" ? Math.round(v * 100) : null);

/** Lit un onglet mensuel : colonnes reconnues, mouvements ligne par ligne, trésoreries de début et de fin. */
export function lireOngletMensuel(g: Grille, onglet: string): OngletRepris | null {
  const mois = moisDeOnglet(onglet);
  if (!mois) return null;
  const maxCol = Math.max(...[1, 2, 3, 4].map((l) => Math.max(0, ...(g.get(l)?.keys() ?? []))));
  // Colonnes : libellé ligne 3 (à défaut ligne 2), nature ligne 4 (H.T., TTC ou précision).
  type Colonne = { categorieId: string | null; libelle: string; ht?: number; ttc?: number; seule?: number };
  const colonnes: Colonne[] = [];
  for (let c = 7; c <= maxCol; c++) {
    const nature = normaliser(cellule(g, 4, c));
    const derniere = colonnes.at(-1);
    // Une colonne TTC suit sa colonne H.T. : dans le fichier, le libellé est fusionné sur les deux, donc seule la
    // première le porte. On l'apparie à la colonne H.T. précédente encore seule.
    if (nature === "ttc" && derniere && derniere.ht === c - 1 && derniere.ttc === undefined) {
      derniere.ttc = c;
      continue;
    }
    // Sous-colonne d'un libellé fusionné (« Rémunération » : « Charges » puis « Net à payer ») : même libellé.
    const libelle = cellule(g, 3, c) ?? cellule(g, 2, c) ?? (nature && derniere ? derniere.libelle : null);
    if (libelle == null) continue;
    const categorieId = categorieDeEntete(libelle, cellule(g, 4, c));
    const col: Colonne = { categorieId, libelle: normaliser(libelle) };
    if (nature === "h.t." || nature === "ht") col.ht = c;
    else if (nature === "ttc") col.ttc = c;
    else col.seule = c;
    colonnes.push(col);
  }
  // Lignes : de la 5e jusqu'au « Total: » ou « Totaux: » (colonne F).
  let fin = 5;
  while (fin < 1000 && !/^tota(l|ux)\b/.test(normaliser(cellule(g, fin, 6)))) fin++;
  const mouvements: MouvementRepris[] = [];
  const inconnues = new Set<string>();
  let datesCorrigees = 0;
  for (let l = 5; l < fin; l++) {
    // Le tableur compte chaque ligne dans le mois de son onglet, même datée d'un autre mois (ligne recopiée sans
    // changer la date, faute de frappe « 2030 ») : on garde le jour, dans le mois de l'onglet, et la date d'origine
    // dans l'objet. Les totaux mensuels restent ceux du tableur.
    const lue = lireDate(cellule(g, l, 1));
    let date = lue ?? `${mois}-01`;
    let note = "";
    if (lue && !lue.startsWith(mois)) {
      const [a, m] = mois.split("-").map(Number);
      const dernier = new Date(Date.UTC(a, m, 0)).getUTCDate();
      date = `${mois}-${String(Math.min(Number(lue.slice(8, 10)), dernier)).padStart(2, "0")}`;
      note = ` (date du tableur : ${lue.slice(8, 10)}/${lue.slice(5, 7)}/${lue.slice(0, 4)})`;
      datesCorrigees++;
    }
    for (const col of colonnes) {
      const ht = col.ht ? centimes(cellule(g, l, col.ht)) : null;
      const ttcLu = col.ttc ? centimes(cellule(g, l, col.ttc)) : col.seule ? centimes(cellule(g, l, col.seule)) : null;
      if (!ht && !ttcLu) continue;
      if (!col.categorieId) {
        inconnues.add(col.libelle);
        continue;
      }
      const ttcBrut = ttcLu ?? ht!;
      const htBrut = ht ?? ttcBrut;
      const signe = SIGNEES.has(col.categorieId) ? 1 : RECETTES.has(col.categorieId) ? 1 : -1;
      const ttc = signe * ttcBrut;
      const htSigne = SIGNEES.has(col.categorieId) ? ttc : signe * htBrut;
      mouvements.push({
        cle: `reprise:${mois}:${l}:${col.categorieId}:${col.ht ?? col.ttc ?? col.seule}`,
        date,
        tiers: cellule(g, l, 2) == null ? null : String(cellule(g, l, 2)).trim(),
        reference: cellule(g, l, 3) == null ? null : String(cellule(g, l, 3)).trim(),
        dateEmission: lireDate(cellule(g, l, 4)),
        mode: mode(cellule(g, l, 5)),
        objet: (String(cellule(g, l, 6) ?? cellule(g, l, 2) ?? "Mouvement repris").trim() || "Mouvement repris") + note,
        categorieId: col.categorieId,
        ht: htSigne,
        tva: ttc - htSigne,
        ttc,
      });
    }
  }
  // Pied : trésoreries de début et de fin de mois (colonne G).
  let debut: number | null = null;
  let finMois: number | null = null;
  for (const [l, cols] of g) {
    const f = normaliser(cols.get(6) ?? null);
    if (/tresorerie disponible en debut/.test(f)) debut = centimes(cellule(g, l, 7));
    if (/tresorerie disponible en fin/.test(f)) finMois = centimes(cellule(g, l, 7));
  }
  return { onglet, mois, mouvements, debut, fin: finMois, inconnues: [...inconnues], datesCorrigees };
}
