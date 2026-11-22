/*
 * Reprise du « Tableau de gestion » (exercice en cours + les 2 précédents, décidé le 22/11/2026, Q-T7).
 *
 *   bun scripts/importer-tableurs.ts "docs/sources/Tableau de gestion.xlsx"             # essai : rapport seul
 *   bun scripts/importer-tableurs.ts "docs/sources/Tableau de gestion.xlsx" --ecrire    # écrit dans ./data
 *
 * Serveur arrêté pour --ecrire (verrou d'instance). Rejouable : chaque mouvement porte une clé d'import
 * (« reprise:mois:ligne:catégorie ») et n'est créé qu'une fois. La trésorerie d'ouverture de chaque exercice est
 * celle du début de juin lue dans le tableur. Le rapport compare, mois par mois, la somme des mouvements repris à
 * l'écart « fin − début » du tableur : un écart signale une formule cassée ou une colonne non reconnue.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Classeur } from "./reprise/xlsx";
import { lireOngletMensuel, type OngletRepris } from "./reprise/tableurs";

const [chemin, ...options] = process.argv.slice(2);
if (!chemin) {
  console.error('Usage : bun scripts/importer-tableurs.ts "chemin/Tableau de gestion.xlsx" [--ecrire] [--depuis 2024-06]');
  process.exit(1);
}
const ecrire = options.includes("--ecrire");
const depuis = options[options.indexOf("--depuis") + 1]?.match(/^\d{4}-\d{2}$/) ? options[options.indexOf("--depuis") + 1] : "2024-06";
const euros = (c: number | null) => (c == null ? "—" : (c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €");

const classeur = new Classeur(new Uint8Array(readFileSync(chemin)));
const onglets: OngletRepris[] = [];
for (const o of classeur.onglets) {
  const g = classeur.grille(o.nom);
  const r = g && lireOngletMensuel(g, o.nom);
  if (r && r.mois >= depuis) onglets.push(r);
}
onglets.sort((a, b) => a.mois.localeCompare(b.mois));

console.log(`${onglets.length} mois repris (${onglets[0]?.mois} → ${onglets.at(-1)?.mois}), ${onglets.reduce((s, o) => s + o.mouvements.length, 0)} mouvements.\n`);
console.log("Mois      Mouvements   Somme reprise      Fin − début tableur   Écart          Chaînage");
let ecarts = 0;
for (const [i, o] of onglets.entries()) {
  const somme = o.mouvements.reduce((s, m) => s + m.ttc, 0);
  const attendu = o.debut != null && o.fin != null ? o.fin - o.debut : null;
  const ecart = attendu == null ? null : somme - attendu;
  const precedent = onglets[i - 1];
  const chaine = precedent?.fin != null && o.debut != null && Math.abs(precedent.fin - o.debut) > 1 ? `début ≠ fin précédente (${euros(o.debut - precedent.fin)})` : "";
  if (ecart && Math.abs(ecart) > 1) ecarts++;
  console.log(
    `${o.mois}   ${String(o.mouvements.length).padStart(5)}   ${euros(somme).padStart(16)}   ${euros(attendu).padStart(18)}   ${(ecart && Math.abs(ecart) > 1 ? euros(ecart) : "ok").padStart(12)}   ${chaine}`,
  );
  if (o.inconnues.length) console.log(`          colonnes non reconnues : ${o.inconnues.join(", ")}`);
}
console.log(`\n${ecarts} mois avec un écart.`);

if (!ecrire) {
  console.log("\nEssai seulement : rien n'est écrit. Ajoutez --ecrire (serveur arrêté) pour importer dans ./data.");
  process.exit(0);
}

const { ouvrirBase, fermerBase } = await import("../serveur/base");
const { DOSSIER_DONNEES } = await import("../serveur/config");
const { query, batch } = await import("../src/db/client");
ouvrirBase(join(DOSSIER_DONNEES, "donnees.db"), join(import.meta.dir, "..", "drizzle"));
let crees = 0;
for (const o of onglets) {
  const sts = [];
  for (const m of o.mouvements) {
    const [deja] = await query("select 1 from mouvement where cle_import = ?", [m.cle]);
    if (deja) continue;
    sts.push({
      sql: `insert into mouvement (id, date, tiers, mode, objet, categorie_id, ht, tva, ttc, reference, date_emission, source, cle_import)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reprise', ?)`,
      params: [crypto.randomUUID(), m.date, m.tiers, m.mode, m.objet, m.categorieId, m.ht, m.tva, m.ttc, m.reference, m.dateEmission, m.cle],
    });
  }
  if (sts.length) await batch(sts);
  crees += sts.length;
  // Ouverture de l'exercice : la trésorerie de début de juin.
  if (o.mois.endsWith("-06") && o.debut != null) await query("update exercice set tresorerie_ouverture = ? where debut = ?", [o.debut, `${o.mois}-01`]);
}
fermerBase();
console.log(`\n${crees} mouvements créés (les autres existaient déjà). Trésoreries d'ouverture des exercices mises à jour.`);
