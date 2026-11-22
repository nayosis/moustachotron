/*
 * Lecture minimale d'un classeur .xlsx (un ZIP de XML) avec fflate, déjà dépendance du socle : noms des onglets et
 * valeurs des cellules (les formules sont lues par leur dernière valeur calculée, enregistrée par Excel).
 * Suffisant pour la reprise des tableurs ; pas un lecteur général (pas de styles, de dates typées…).
 */
import { strFromU8, unzipSync } from "fflate";

export type Valeur = string | number | null;
/** Grille d'un onglet : ligne (1…) → colonne (1…) → valeur. */
export type Grille = Map<number, Map<number, Valeur>>;

const ENTITES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&amp;": "&" };
const decoder = (t: string) => t.replace(/&(lt|gt|quot|apos|amp);|&#(\d+);|&#x([0-9a-f]+);/gi, (m, _n, d, h) => (d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : ENTITES[m]));

/** « AB12 » → [12, 28]. */
export function adresse(ref: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`Adresse de cellule illisible : ${ref}`);
  let col = 0;
  for (const c of m[1]) col = col * 26 + (c.charCodeAt(0) - 64);
  return [Number(m[2]), col];
}

/** Texte d'un élément <si> ou <is> (une ou plusieurs séquences <t>). */
const texte = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => decoder(x[1])).join("");

export class Classeur {
  private fichiers: Record<string, Uint8Array>;
  private partages: string[];
  readonly onglets: { nom: string; chemin: string }[];

  constructor(octets: Uint8Array) {
    this.fichiers = unzipSync(octets);
    const lire = (c: string) => (this.fichiers[c] ? strFromU8(this.fichiers[c]) : "");
    this.partages = [...lire("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texte(m[1]));
    const liens = new Map([...lire("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])![1], /Target="([^"]+)"/.exec(m[0])![1]]));
    this.onglets = [...lire("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)].map((m) => {
      const nom = decoder(/name="([^"]*)"/.exec(m[0])![1]);
      const cible = liens.get(/r:id="([^"]+)"/.exec(m[0])![1])!;
      return { nom, chemin: cible.startsWith("/") ? cible.slice(1) : `xl/${cible}` };
    });
  }

  /** Valeurs d'un onglet (null si l'onglet n'existe pas). */
  grille(nom: string): Grille | null {
    const o = this.onglets.find((x) => x.nom === nom);
    if (!o) return null;
    const xml = strFromU8(this.fichiers[o.chemin]);
    const g: Grille = new Map();
    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributs = m[1];
      const corps = m[2] ?? "";
      const [ligne, col] = adresse(/r="([A-Z]+\d+)"/.exec(attributs)![1]);
      const type = /t="([^"]+)"/.exec(attributs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(corps)?.[1];
      let valeur: Valeur = null;
      if (type === "s" && v !== undefined) valeur = this.partages[Number(v)] ?? null;
      else if (type === "inlineStr") valeur = texte(corps);
      else if (type === "str" || type === "e") valeur = v === undefined ? null : decoder(v);
      else if (type === "b") valeur = v === "1" ? 1 : 0;
      else if (v !== undefined && v !== "") valeur = Number(v);
      if (valeur === null || valeur === "") continue;
      if (!g.has(ligne)) g.set(ligne, new Map());
      g.get(ligne)!.set(col, valeur);
    }
    return g;
  }
}

/** Valeur d'une cellule d'une grille. */
export const cellule = (g: Grille, ligne: number, col: number): Valeur => g.get(ligne)?.get(col) ?? null;

/** Date Excel (nombre de jours depuis le 30/12/1899) → « AAAA-MM-JJ ». */
export const dateExcel = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000).toISOString().slice(0, 10);
