/*
 * Échéances des projets : planification depuis le prix de la mission, facturation (n° et date), règlement
 * (crée le mouvement de trésorerie). Conception § Saisie du réalisé (décidé le 22/11/2026, Q-T5).
 */
import { batch, newId, query } from "../db/client";
import { CODES_JALONS, type CodeJalon } from "../lib/jalons";
import { ErreurMetier } from "../../serveur/erreurs";
import { aujourdhui } from "../lib/dates";
import { DATE, exiger, texteLibre, texteObligatoire } from "./_commun";
import { ecartEcheances, planifier } from "./_echeances";

export type ModeReglement = "virement" | "prelevement" | "cb" | "cheque" | "especes" | "autre";
const MODES: ModeReglement[] = ["virement", "prelevement", "cb", "cheque", "especes", "autre"];

async function lire(id: string) {
  const [l] = await query(
    `select e.statut, e.ttc, e.ht, e.sens, e.categorie_id, e.projet_id, e.libelle, e.mouvement_id, e.numero_facture, p.reference, c.nom, coalesce(pc.nom, '')
     from echeance e join projet p on p.id = e.projet_id join contact c on c.id = p.client_id left join contact pc on pc.id = e.payeur_id
     where e.id = ? and e.archive = 0`,
    [id],
  );
  if (!l) throw new ErreurMetier("Échéance introuvable.", 404);
  const [statut, ttc, ht, sens, categorieId, projetId, libelle, mouvementId, numeroFacture, reference, clientNom, payeurNom] = l;
  return {
    statut: statut as "prevue" | "facturee" | "reglee",
    ttc: Number(ttc),
    ht: Number(ht),
    sens: sens as "entree" | "sortie",
    categorieId: String(categorieId),
    projetId: String(projetId),
    libelle: String(libelle),
    mouvementId: mouvementId as string | null,
    numeroFacture: numeroFacture as string | null,
    reference: String(reference),
    clientNom: String(clientNom),
    payeurNom: String(payeurNom),
  };
}

// --- Lecture

/** Ce que changerait une mise à jour de l'échéancier (créées, modifiées, retirées). */
export async function apercuEcheances(projetId: string) {
  await exiger("projet", projetId, "Projet");
  const { creees, modifiees, retirees } = await ecartEcheances(projetId);
  return {
    creees: creees.map((c) => ({ libelle: c.libelle, ttc: c.ttc })),
    modifiees: modifiees.map((c) => ({ libelle: c.libelle, avantTtc: c.avantTtc, ttc: c.ttc })),
    retirees: retirees.map((e) => ({ libelle: e.libelle, ttc: e.ttc })),
  };
}

// --- Écriture

/** Crée ou met à jour l'échéancier d'un projet (les échéances facturées ou réglées ne bougent pas). */
export async function planifierEcheances(projetId: string) {
  await exiger("projet", projetId, "Projet");
  return planifier(projetId);
}

/** Facture une échéance : numéro, date et, si besoin, montant TTC réellement facturé (le HT suit au même taux). */
export async function facturerEcheance(id: string, v: { numero: string; date: string; ttc?: number | null }) {
  const e = await lire(id);
  if (e.statut === "reglee") throw new ErreurMetier("Cette échéance est déjà réglée.");
  if (!DATE.test(v.date ?? "")) throw new ErreurMetier("Date de facture invalide.");
  const ttc = v.ttc ?? e.ttc;
  if (!Number.isInteger(ttc) || ttc <= 0) throw new ErreurMetier("Montant TTC invalide.");
  const ht = e.ttc ? Math.round((ttc * e.ht) / e.ttc) : ttc;
  await query("update echeance set statut = 'facturee', numero_facture = ?, date_facture = ?, ttc = ?, ht = ? where id = ?", [texteObligatoire(v.numero, "N° de facture", 60), v.date, ttc, ht, id]);
}

/** Règle une échéance : crée le mouvement de trésorerie (+ entrée, − sortie) et la marque réglée. */
export async function reglerEcheance(id: string, v: { date: string; mode: ModeReglement; tiers?: string | null }) {
  const e = await lire(id);
  if (e.statut === "reglee") throw new ErreurMetier("Cette échéance est déjà réglée.");
  if (!DATE.test(v.date ?? "")) throw new ErreurMetier("Date de règlement invalide.");
  if (v.date > aujourdhui()) throw new ErreurMetier("Un règlement ne peut pas être daté dans le futur.");
  if (!MODES.includes(v.mode)) throw new ErreurMetier("Mode de règlement inconnu.");
  const signe = e.sens === "entree" ? 1 : -1;
  const mouvement = newId();
  await batch([
    {
      sql: `insert into mouvement (id, date, tiers, mode, objet, categorie_id, ht, tva, ttc, projet_id, reference, source)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'echeance')`,
      params: [mouvement, v.date, texteLibre(v.tiers) ?? (e.payeurNom || e.clientNom), v.mode, `${e.clientNom} — ${e.libelle} (${e.reference})`, e.categorieId, signe * e.ht, signe * (e.ttc - e.ht), signe * e.ttc, e.projetId, e.numeroFacture],
    },
    { sql: "update echeance set statut = 'reglee', mouvement_id = ? where id = ?", params: [mouvement, id] },
  ]);
  return mouvement;
}

/** Annule un règlement saisi par erreur : le mouvement est archivé, l'échéance revient « facturée » (ou « prévue »). */
export async function annulerReglement(id: string) {
  const e = await lire(id);
  if (e.statut !== "reglee" || !e.mouvementId) throw new ErreurMetier("Cette échéance n'est pas réglée.");
  await batch([
    { sql: "update mouvement set archive = 1 where id = ?", params: [e.mouvementId] },
    { sql: "update echeance set statut = case when numero_facture is null then 'prevue' else 'facturee' end, mouvement_id = null where id = ?", params: [id] },
  ]);
}

/**
 * Échéance saisie à la main, hors du calcul de l'échéancier (reste à facturer repris des tableurs, encaissement
 * exceptionnel…) : datée par un jalon du projet ou une date forcée. Jamais retirée par « Mettre à jour l'échéancier ».
 */
export async function ajouterEcheance(
  projetId: string,
  v: { libelle: string; sens: "entree" | "sortie"; categorieId: string; ht: number; ttc: number; jalon: string; date?: string | null },
) {
  await exiger("projet", projetId, "Projet");
  if (v.sens !== "entree" && v.sens !== "sortie") throw new ErreurMetier("Sens inconnu.");
  if (!CODES_JALONS.has(v.jalon as CodeJalon)) throw new ErreurMetier("Jalon inconnu.");
  if (!Number.isInteger(v.ttc) || v.ttc <= 0 || !Number.isInteger(v.ht) || v.ht <= 0 || v.ht > v.ttc) throw new ErreurMetier("Montants invalides (HT et TTC positifs, HT ≤ TTC).");
  if (v.date && !DATE.test(v.date)) throw new ErreurMetier("Date invalide.");
  const [c] = await query("select 1 from categorie where id = ?", [v.categorieId]);
  if (!c) throw new ErreurMetier("Catégorie inconnue.");
  const id = newId();
  await query(
    "insert into echeance (id, projet_id, code, libelle, sens, categorie_id, jalon, date_forcee, ttc, ht) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, projetId, `manuelle:${id}`, texteObligatoire(v.libelle, "Libellé"), v.sens, v.categorieId, v.jalon, v.date || null, v.ttc, v.ht],
  );
  return id;
}

/** Force la date d'une échéance (null : revient à la date de son jalon). */
export async function forcerDateEcheance(id: string, date: string | null) {
  const e = await lire(id);
  if (e.statut === "reglee") throw new ErreurMetier("Cette échéance est déjà réglée.");
  if (date && !DATE.test(date)) throw new ErreurMetier("Date invalide.");
  await query("update echeance set date_forcee = ? where id = ?", [date || null, id]);
}
