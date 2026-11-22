/**
 * Lecture d'un relevé bancaire exporté en CSV (conception § Saisie du réalisé, skill `tresorerie` § Import).
 * Tolérant aux exports des banques françaises : séparateur « ; », « , » ou tabulation ; colonnes « Montant » ou
 * « Débit » + « Crédit » ; dates « jj/mm/aaaa » ou ISO ; nombres « -1 234,56 ». Fonctions pures.
 */

export type LigneReleve = { date: string; libelle: string; montant: number };

const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Découpe une ligne CSV (guillemets doublés gérés). */
function decouper(ligne: string, sep: string) {
  const res: string[] = [];
  let cur = "";
  let guillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (c === '"') {
      if (guillemets && ligne[i + 1] === '"') {
        cur += '"';
        i++;
      } else guillemets = !guillemets;
    } else if (c === sep && !guillemets) {
      res.push(cur);
      cur = "";
    } else cur += c;
  }
  res.push(cur);
  return res.map((x) => x.trim());
}

/** « -1 234,56 », « 1234.56 », « 1.234,56 » → centimes ; null si vide ou illisible. */
export function lireNombre(s: string): number | null {
  let t = s.replace(/[\s  €]/g, "").replace("−", "-");
  if (!t) return null;
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** « 03/10/2026 », « 03/10/26 », « 2026-10-03 » → « 2026-10-03 ». */
export function lireDateReleve(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (!m) return null;
  const a = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Lit le relevé ; `erreur` si les colonnes ne sont pas reconnues (avec les en-têtes vus). */
export function lireReleve(texte: string): { lignes: LigneReleve[]; erreur?: string } {
  const brutes = texte.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!brutes.length) return { lignes: [], erreur: "Fichier vide." };
  // Ligne d'en-têtes : la première qui parle de date et de montant (les banques mettent parfois un titre avant).
  const iEntete = brutes.findIndex((l) => /date/i.test(l) && /(montant|d[ée]bit|cr[ée]dit)/i.test(l));
  if (iEntete < 0) return { lignes: [], erreur: `Colonnes non reconnues : il faut une date et un montant (ou débit / crédit). Première ligne : « ${brutes[0].slice(0, 120)} ».` };
  const sep = [";", "\t", ","].map((s) => [s, brutes[iEntete].split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const entetes = decouper(brutes[iEntete], sep).map(sansAccents);
  const col = (...motifs: RegExp[]) => {
    for (const m of motifs) {
      const i = entetes.findIndex((e) => m.test(e));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iDate = col(/date.*op/, /^date$/, /date/);
  const iLibelle = col(/libell/, /operation|op[ée]ration/, /intitul|description|detail/);
  const iMontant = col(/montant/);
  const iDebit = col(/debit/);
  const iCredit = col(/credit/);
  if (iDate < 0 || iLibelle < 0 || (iMontant < 0 && iDebit < 0 && iCredit < 0))
    return { lignes: [], erreur: `Colonnes non reconnues (${entetes.join(", ")}) : il faut une date, un libellé et un montant (ou débit / crédit).` };
  const lignes: LigneReleve[] = [];
  for (const brute of brutes.slice(iEntete + 1)) {
    const c = decouper(brute, sep);
    const date = lireDateReleve(c[iDate] ?? "");
    if (!date) continue;
    let montant: number | null;
    if (iMontant >= 0) montant = lireNombre(c[iMontant] ?? "");
    else {
      const debit = lireNombre(c[iDebit] ?? "") ?? 0;
      const credit = lireNombre(c[iCredit] ?? "") ?? 0;
      // Certains exports mettent le débit en négatif, d'autres en positif : un débit sort toujours.
      montant = credit - Math.abs(debit);
    }
    if (!montant) continue;
    lignes.push({ date, libelle: (c[iLibelle] ?? "").replace(/\s+/g, " ").trim(), montant });
  }
  return { lignes };
}

/** Mots du libellé qui identifient le tiers : sans les mots techniques de la banque, les dates et les numéros. */
const BRUIT = new Set(["prlv", "sepa", "vir", "virement", "recu", "emis", "inst", "carte", "cb", "paiement", "par", "de", "du", "le", "la", "les", "des", "chq", "cheque", "remise", "facture", "fact", "ref", "x", "web"]);
export function motsCles(libelle: string) {
  return sansAccents(libelle)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((m) => m.length > 1 && !BRUIT.has(m) && !/\d/.test(m))
    .slice(0, 2)
    .join(" ");
}

/** Mode de règlement deviné d'après le libellé bancaire. */
export function modeDuLibelle(libelle: string): "virement" | "prelevement" | "cb" | "cheque" | "autre" {
  const l = sansAccents(libelle);
  if (/^prlv|prelev/.test(l)) return "prelevement";
  if (/^vir|virement/.test(l)) return "virement";
  if (/^(cb|carte|paiement cb)/.test(l)) return "cb";
  if (/^(chq|cheque|remise ch)/.test(l)) return "cheque";
  return "autre";
}

/** Clé d'import d'une ligne : même date, même montant, même libellé = même ligne (rejouer n'importe rien deux fois). */
export const cleReleve = (l: LigneReleve, occurrence = 0) => `releve:${l.date}:${l.montant}:${sansAccents(l.libelle)}${occurrence ? `:${occurrence}` : ""}`;
