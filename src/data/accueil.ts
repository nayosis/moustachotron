/*
 * Tableau de bord (accueil) : ce qui demande une action aujourd'hui. La trésorerie y viendra en phase 2.
 */
import { aujourdhui } from "../lib/dates";
import { attestationsAEcheance } from "./documents";
import { listeRelances, projetsSansNouvelles } from "./interactions";
import { listeProjets } from "./projets";

/** Relances dues, projets sans nouvelles, jalons prévus dans les 14 jours ou en retard, attestations à renouveler. */
export async function tableauDeBord() {
  const aujd = aujourdhui();
  const dans14 = new Date(`${aujd}T12:00:00Z`);
  dans14.setUTCDate(dans14.getUTCDate() + 14);
  const borne = dans14.toISOString().slice(0, 10);
  const [relances, sansNouvelles, attestations, projets] = await Promise.all([listeRelances(aujd), projetsSansNouvelles(), attestationsAEcheance(), listeProjets()]);
  const parColonne: Record<string, number> = {};
  for (const p of projets) {
    const c = p.jalon?.colonne ?? "prospect";
    parColonne[c] = (parColonne[c] ?? 0) + 1;
  }
  const aVenir = projets
    .filter((p) => p.prochain?.date && p.prochain.date <= borne)
    .map((p) => ({ id: p.id, reference: p.reference, intitule: p.intitule, clientNom: p.clientNom, jalon: p.prochain!.libelle, date: p.prochain!.date!, enRetard: p.prochain!.enRetard }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    relances,
    sansNouvelles,
    attestations,
    aVenir,
    parColonne,
    enCours: projets.length,
    honorairesHt: projets.reduce((s, p) => s + p.honorairesHt, 0),
  };
}
