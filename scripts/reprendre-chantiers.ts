/*
 * Reprise des chantiers en cours depuis « Chantiers Année 3.xlsx » (reste à facturer par chantier) :
 *
 *   bun scripts/reprendre-chantiers.ts "docs/sources/Chantiers Année 3.xlsx" "docs/sources/Tableau de gestion.xlsx"            # essai
 *   bun scripts/reprendre-chantiers.ts "docs/sources/Chantiers Année 3.xlsx" "docs/sources/Tableau de gestion.xlsx" --ecrire   # par l'API
 *
 * Chaque chantier devient un projet (client, mission, estimation des travaux) avec, en échéances saisies à la main,
 * son reste à facturer : honoraires (au jalon « réception des travaux », « remise du rapport » pour une expertise) et
 * commission (au jalon « démarrage des travaux »). Le tableur ne donne pas de dates : les échéances restent « à
 * dater » jusqu'à ce que ces jalons soient datés dans l'application. Les jalons déjà atteints (mission validée,
 * démarrage) sont datés d'après les mouvements repris qui citent le client. --ecrire passe par l'API (serveur
 * lancé, compte de .env) : contrôles et journal compris ; refusé si des projets existent déjà.
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Classeur, cellule } from "./reprise/xlsx";
import { normaliser } from "./reprise/tableurs";
import { lirePlanDeCharge } from "./reprise/plan-de-charge";

const [cheminChantiers, cheminGestion] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ecrire = process.argv.includes("--ecrire");
const euros = (c: number) => (c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const centimes = (v: unknown) => (typeof v === "number" ? Math.round(v * 100) : 0);

// Missions connues par le plan de charge (nom de famille → mission).
const missions = new Map<string, string>();
for (const p of lirePlanDeCharge(new Classeur(new Uint8Array(readFileSync(cheminGestion))).grille("Plan de charge projets")!, 2024))
  missions.set(normaliser(p.client).split(" ")[0], p.missionCode);

type Chantier = { client: string; entite: "conseil" | "reseau"; reliquat: boolean; missionCode: string; travauxTtc: number | null; resteHonorairesHt: number; resteCommissionHt: number };
const classeur = new Classeur(new Uint8Array(readFileSync(cheminChantiers)));
const grille = classeur.grille(classeur.onglets[0].nom)!;
const chantiers: Chantier[] = [];
let reliquat = true;
let entite: "conseil" | "reseau" = "conseil";
for (const l of [...grille.keys()].sort((a, b) => a - b)) {
  const a = normaliser(cellule(grille, l, 1));
  if (/reliquat/.test(a)) reliquat = true;
  if (/signes en annee/.test(a)) reliquat = false;
  if (/^a facturer|^deja facture|^total/.test(a)) break;
  const b = normaliser(cellule(grille, l, 2));
  if (/rc consulting/.test(b)) entite = "conseil";
  if (/camif/.test(b)) entite = "reseau";
  const client = String(cellule(grille, l, 3) ?? "").replace(/\s+/g, " ").trim();
  if (!client || /^nom prenom|^total|^panier|^total tvx/i.test(normaliser(client))) continue;
  // Reliquat : colonnes E (honoraires) et F (commission) = reste à facturer. Signés : M et N (reste calculé).
  const resteHonorairesHt = reliquat ? centimes(cellule(grille, l, 5)) : centimes(cellule(grille, l, 13));
  const resteCommissionHt = reliquat ? centimes(cellule(grille, l, 6)) : centimes(cellule(grille, l, 14));
  if (resteHonorairesHt <= 0 && resteCommissionHt <= 0) continue;
  const nomFamille = normaliser(client).split(" ")[0];
  chantiers.push({
    client,
    entite,
    reliquat,
    missionCode: entite === "conseil" ? "EXP" : (missions.get(nomFamille) ?? "AMO"),
    travauxTtc: centimes(cellule(grille, l, 4)) || null,
    resteHonorairesHt: Math.max(0, resteHonorairesHt),
    resteCommissionHt: Math.max(0, resteCommissionHt),
  });
}

// Jalons atteints, d'après les mouvements repris qui citent le client (nom de famille dans l'objet).
const base = new Database(join(import.meta.dir, "..", "data", "donnees.db"), { readonly: true });
const mentions = (nom: string, categories?: string[]) =>
  base
    .query<{ date: string }, [string]>(`select date from mouvement where archive = 0 and upper(objet) like ? ${categories ? `and categorie_id in (${categories.map((c) => `'${c}'`).join(",")})` : ""} order by date limit 1`)
    .get(`%${nom.toUpperCase()}%`)?.date ?? null;

const plan = chantiers.map((c) => {
  const nom = c.client.split(" ")[0].replace(/[^\p{L}-]/gu, "");
  const premier = mentions(nom);
  const demarrage = c.entite === "reseau" ? mentions(nom, ["commission_edb"]) : null;
  return { ...c, nom, validation: premier, demarrage };
});

console.log("Client                         Mission  Travaux TTC     Reste honoraires HT  Reste commission HT  Mission validée  Démarrage");
for (const c of plan)
  console.log(
    `${c.client.padEnd(30)} ${c.missionCode.padEnd(8)} ${(c.travauxTtc ? euros(c.travauxTtc) : "—").padStart(13)}  ${euros(c.resteHonorairesHt).padStart(18)}  ${euros(c.resteCommissionHt).padStart(18)}   ${(c.validation ?? "—").padEnd(14)}  ${c.demarrage ?? "—"}${c.reliquat ? "  (reliquat année 2)" : ""}`,
  );
const totH = plan.reduce((s, c) => s + c.resteHonorairesHt, 0);
const totC = plan.reduce((s, c) => s + c.resteCommissionHt, 0);
console.log(`\n${plan.length} chantiers ; reste à facturer ${euros(totH)} d'honoraires et ${euros(totC)} de commissions (HT).`);

if (!ecrire) {
  console.log("\nEssai seulement : rien n'est écrit. Ajoutez --ecrire (serveur lancé) pour créer les projets par l'API.");
  process.exit(0);
}

const env = Object.fromEntries(
  readFileSync(join(import.meta.dir, "..", ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const API = "http://localhost:3220";
const r = await fetch(`${API}/api/auth/connexion`, { method: "POST", headers: { "content-type": "application/json", "x-app": "1" }, body: JSON.stringify({ email: env.SUPER_ADMIN_EMAIL, motDePasse: env.SUPER_ADMIN_MOT_DE_PASSE, souvenir: false }) });
if (!r.ok) throw new Error(`Connexion refusée (${r.status}) : le serveur est-il lancé ?`);
const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
const rpc = async (nom: string, ...args: unknown[]) => {
  const x = await fetch(`${API}/api/rpc/${nom}`, { method: "POST", headers: { "content-type": "application/json", "x-app": "1", cookie }, body: JSON.stringify({ args }) });
  const corps = await x.json();
  if (!x.ok) throw new Error(`${nom} : ${corps.erreur}`);
  return corps.resultat;
};
if ((await rpc("listeProjets", { issue: "tous" })).length) throw new Error("Des projets existent déjà : reprise refusée (pour ne rien créer en double).");

const CATEGORIE_HONORAIRES: Record<string, string> = { AMO: "hono_amo", MOE: "hono_moe", COU: "courtage", EAA: "eaa", EXP: "expertise" };
for (const c of plan) {
  const id = await rpc("creerProjet", {
    intitule: c.reliquat ? "Chantier (reprise, reliquat année 2)" : "Chantier (reprise, signé en année 3)",
    missionCode: c.missionCode,
    origineCode: c.entite === "reseau" ? "reseau" : "autre",
    nouveauClient: { nom: c.client },
    recuLe: c.validation ?? undefined,
  });
  const p = await rpc("ficheProjet", id);
  if (c.travauxTtc && c.missionCode !== "EXP") await rpc("majProjet", id, { estimationTtc: c.travauxTtc }, p.modifieLe);
  // Les échéances d'abord : le projet a alors un échéancier, la validation de la mission n'en calcule pas un autre.
  const tvaHonoraires = c.missionCode === "EXP" || c.missionCode === "EAA" ? 12_000 : 11_000;
  if (c.resteHonorairesHt > 0)
    await rpc("ajouterEcheance", id, {
      libelle: "Honoraires restant à facturer (reprise)",
      sens: "entree",
      categorieId: CATEGORIE_HONORAIRES[c.missionCode] ?? "hono_amo",
      ht: c.resteHonorairesHt,
      ttc: Math.round((c.resteHonorairesHt * tvaHonoraires) / 10_000),
      jalon: c.missionCode === "EXP" ? "remise_rapport" : "reception_travaux",
    });
  if (c.resteCommissionHt > 0)
    await rpc("ajouterEcheance", id, {
      libelle: c.entite === "conseil" ? "Apport d'affaires à recevoir (reprise)" : "Commissions restant à facturer (reprise)",
      sens: "entree",
      categorieId: c.entite === "conseil" ? "apport_recu" : "commission_edb",
      ht: c.resteCommissionHt,
      ttc: Math.round((c.resteCommissionHt * 12_000) / 10_000),
      jalon: c.entite === "conseil" ? "remise_rapport" : "demarrage_travaux",
    });
  if (c.validation) await rpc("fixerJalon", id, "validation_mission", { dateReelle: c.validation });
  if (c.demarrage) await rpc("fixerJalon", id, "demarrage_travaux", { dateReelle: c.demarrage });
  console.log(`✓ ${c.client}`);
}
console.log(`\n${plan.length} projets créés.`);
