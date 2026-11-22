/*
 * Import du relevé bancaire (décidé le 22/11/2026, Q-T5) : chaque ligne est proposée avec ce qu'elle est
 * probablement — une échéance facturée qui est encaissée, une charge récurrente, ou la catégorie habituelle de ce
 * tiers (apprise des mouvements précédents) — puis importée après relecture. Rejouable sans doublon.
 */
import { batch, newId, query, type Statement } from "../db/client";
import { ErreurMetier } from "../../serveur/erreurs";
import { htDepuisTtc } from "../lib/prix";
import { cleReleve, modeDuLibelle, motsCles, type LigneReleve } from "../lib/releve";
import { DATE } from "./_commun";

export type PropositionReleve = LigneReleve & {
  cle: string;
  /** Déjà importée (même clé). */
  deja: boolean;
  /** Mouvement existant de même montant à ± 3 jours (saisi à la main, réglé depuis une échéance, repris des tableurs). */
  doublon: { id: string; objet: string; date: string } | null;
  echeance: { id: string; libelle: string } | null;
  chargeRecurrenteId: string | null;
  categorieId: string | null;
  raison: string | null;
};

export type LigneAImporter = LigneReleve & { cle: string; categorieId?: string | null; echeanceId?: string | null; chargeRecurrenteId?: string | null };

const ecartJours = (a: string, b: string) => Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function verifier(lignes: LigneReleve[]) {
  if (!Array.isArray(lignes) || lignes.length > 2000) throw new ErreurMetier("Relevé illisible ou trop long (2 000 lignes au plus).");
  for (const l of lignes) {
    if (!DATE.test(l.date ?? "") || !Number.isInteger(l.montant) || !l.montant || typeof l.libelle !== "string") throw new ErreurMetier("Ligne de relevé invalide.");
  }
}

// --- Lecture

/** Propositions pour chaque ligne du relevé (rien n'est écrit). */
export async function analyserReleve(lignes: LigneReleve[]): Promise<PropositionReleve[]> {
  verifier(lignes);
  if (!lignes.length) return [];
  const dates = lignes.map((l) => l.date).sort();
  const [debut, fin] = [dates[0], dates.at(-1)!];
  const [cles, mouvements, echeances, charges, historique] = await Promise.all([
    query("select cle_import from mouvement where cle_import like 'releve:%'"),
    query("select id, date, ttc, objet from mouvement where archive = 0 and date between date(?, '-3 days') and date(?, '+3 days')", [debut, fin]),
    query(
      `select e.id, e.ttc, e.sens, e.libelle, c.nom, p.reference from echeance e join projet p on p.id = e.projet_id join contact c on c.id = p.client_id
       where e.archive = 0 and e.statut <> 'reglee'`,
    ),
    query("select id, libelle, categorie_id, montant_ttc, mot_cle from charge_recurrente where archive = 0"),
    // Catégorie habituelle d'un tiers : apprise des mouvements déjà classés (relevé, saisie, reprise).
    query("select objet, tiers, categorie_id from mouvement where archive = 0 and source <> 'echeance' order by date desc limit 3000"),
  ]);
  const dejaVues = new Set(cles.map((c) => String(c[0])));
  const apprises = new Map<string, Map<string, number>>();
  for (const [objet, tiers, cat] of historique) {
    for (const t of [motsCles(String(objet ?? "")), motsCles(String(tiers ?? ""))]) {
      if (!t) continue;
      const m = apprises.get(t) ?? new Map<string, number>();
      m.set(String(cat), (m.get(String(cat)) ?? 0) + 1);
      apprises.set(t, m);
    }
  }
  const occurrences = new Map<string, number>();
  const echeancesPrises = new Set<string>();
  return lignes.map((l) => {
    const base = cleReleve(l);
    const n = occurrences.get(base) ?? 0;
    occurrences.set(base, n + 1);
    const cle = cleReleve(l, n);
    const libelle = sansAccents(l.libelle);
    const p: PropositionReleve = { ...l, cle, deja: dejaVues.has(cle), doublon: null, echeance: null, chargeRecurrenteId: null, categorieId: null, raison: null };
    const d = mouvements.find(([, date, ttc]) => Number(ttc) === l.montant && ecartJours(String(date), l.date) <= 3);
    if (d) p.doublon = { id: String(d[0]), date: String(d[1]), objet: String(d[3]) };
    // Encaissement d'une échéance : même montant (signe compris), une seule fois par échéance.
    const e = echeances.find(([id, ttc, sens]) => !echeancesPrises.has(String(id)) && (sens === "entree" ? 1 : -1) * Number(ttc) === l.montant);
    if (e) {
      echeancesPrises.add(String(e[0]));
      p.echeance = { id: String(e[0]), libelle: `${e[4]} (${e[5]}) — ${e[3]}` };
      p.raison = "Montant d'une échéance non réglée";
      return p;
    }
    // Charge récurrente : mot-clé du relevé, ou même montant.
    const c = charges.find(([, , , ttc, mot]) => (mot && libelle.includes(sansAccents(String(mot)))) || -Number(ttc) === l.montant);
    if (c && l.montant < 0) {
      p.chargeRecurrenteId = String(c[0]);
      p.categorieId = String(c[2]);
      p.raison = `Charge récurrente « ${c[1]} »`;
      return p;
    }
    const appris = apprises.get(motsCles(l.libelle));
    if (appris) {
      p.categorieId = [...appris].sort((a, b) => b[1] - a[1])[0][0];
      p.raison = "Comme les fois précédentes";
    }
    return p;
  });
}

// --- Écriture

/**
 * Importe les lignes retenues : règlement d'échéance (mouvement lié) ou mouvement de la catégorie choisie. Les lignes
 * déjà importées (même clé) sont ignorées. Renvoie le nombre de mouvements créés et ignorés.
 */
export async function importerReleve(lignes: LigneAImporter[]) {
  verifier(lignes);
  const [categories, cles] = await Promise.all([query("select id, sens, tva_pb from categorie"), query("select cle_import from mouvement where cle_import like 'releve:%'")]);
  const cat = new Map(categories.map(([id, sens, tva]) => [String(id), { sens: String(sens), tvaPb: Number(tva) }]));
  const dejaVues = new Set(cles.map((c) => String(c[0])));
  const sts: Statement[] = [];
  let ignorees = 0;
  for (const l of lignes) {
    if (!l.cle?.startsWith("releve:") || dejaVues.has(l.cle)) {
      ignorees++;
      continue;
    }
    dejaVues.add(l.cle);
    const id = newId();
    const mode = modeDuLibelle(l.libelle);
    if (l.echeanceId) {
      const [e] = await query("select statut, ttc, ht, sens, categorie_id, projet_id, numero_facture from echeance where id = ? and archive = 0", [l.echeanceId]);
      if (!e) throw new ErreurMetier("Échéance introuvable.", 404);
      if (e[0] === "reglee") throw new ErreurMetier("Une des échéances choisies est déjà réglée.");
      const signe = e[3] === "entree" ? 1 : -1;
      if (signe * Number(e[1]) !== l.montant) throw new ErreurMetier(`Le montant de la ligne « ${l.libelle} » ne correspond pas à l'échéance choisie.`);
      sts.push({
        sql: `insert into mouvement (id, date, mode, objet, categorie_id, ht, tva, ttc, projet_id, reference, source, cle_import) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'releve', ?)`,
        params: [id, l.date, mode, l.libelle, e[4], signe * Number(e[2]), signe * (Number(e[1]) - Number(e[2])), l.montant, e[5], e[6], l.cle],
      });
      sts.push({ sql: "update echeance set statut = 'reglee', mouvement_id = ? where id = ?", params: [id, l.echeanceId] });
      continue;
    }
    const c = l.categorieId ? cat.get(l.categorieId) : undefined;
    if (!c) throw new ErreurMetier(`Choisissez une catégorie pour « ${l.libelle} ».`);
    if ((c.sens === "recette" && l.montant < 0) || (c.sens === "depense" && l.montant > 0))
      throw new ErreurMetier(`« ${l.libelle} » : la catégorie choisie ne va pas dans le bon sens (recette / dépense).`);
    const ht = c.sens === "tva" || c.sens === "financement" ? l.montant : Math.sign(l.montant) * htDepuisTtc(Math.abs(l.montant), c.tvaPb);
    sts.push({
      sql: `insert into mouvement (id, date, mode, objet, categorie_id, ht, tva, ttc, charge_recurrente_id, source, cle_import) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'releve', ?)`,
      params: [id, l.date, mode, l.libelle, l.categorieId, ht, l.montant - ht, l.montant, l.chargeRecurrenteId || null, l.cle],
    });
  }
  // Toutes les lignes d'un seul tenant : un relevé n'est jamais importé à moitié.
  if (sts.length) await batch(sts);
  return { crees: lignes.length - ignorees, ignorees };
}
