/*
 * Visites de chantier (docs/rapport-de-visite.md) : rapport cumulatif, présences, points par lot, photos, réserves,
 * rapport envoyé figé, PDF.
 */
import { describe, expect, test } from "bun:test";
import { aujourdhui } from "../src/lib/dates";
import { datesVisite } from "../serveur/rapportVisite";
import { SUPER, serveurDeTest } from "./outils-serveur";

const s = await serveurDeTest();
const { cookie } = await s.connexion(SUPER.email, SUPER.motDePasse);
const appel = async (nom: string, args: unknown[]) => {
  const r = await s.rpc(nom, args, cookie);
  const corps = await r.json();
  return { statut: r.status, resultat: corps.resultat, erreur: corps.erreur as string | undefined };
};
const ok = async (nom: string, ...args: unknown[]) => {
  const r = await appel(nom, args);
  if (r.statut !== 200) throw new Error(`${nom} : ${r.statut} ${r.erreur}`);
  return r.resultat;
};
const erreur = async (nom: string, ...args: unknown[]) => (await appel(nom, args)).erreur;
const envoyer = async () => {
  const f = new FormData();
  f.append("fichier", new File([new Uint8Array([255, 216, 255])], "photo.jpg", { type: "image/jpeg" }));
  return (await (await s.app.handle(new Request("http://local/api/fichiers", { method: "POST", body: f, headers: { "x-app": "1", cookie } }))).json()) as { fichier: string; nom: string };
};

/** Projet AMO avec deux lots confiés à des entreprises. */
async function chantier() {
  const id = await ok("creerProjet", { intitule: "Transformation partielle d'une maison", missionCode: "AMO", origineCode: "reseau", nouveauClient: { nom: "Famille Martin", interlocuteur: "Mme Martin" } });
  const e1 = await ok("creerContact", { type: "entreprise", nom: "Maçonnerie Ouest", interlocuteur: "M. Durand", telephone: "06 00 00 00 01" });
  const e2 = await ok("creerContact", { type: "entreprise", nom: "Élec 17" });
  const l1 = await ok("creerLot", id, { corpsEtat: "Maçonnerie - carrelage", entrepriseId: e1 });
  const l2 = await ok("creerLot", id, { corpsEtat: "Électricité", entrepriseId: e2 });
  return { id, l1, l2 };
}

describe("visites de chantier", () => {
  test("première visite : intervenants du projet (maître d'ouvrage, AMO, un par lot), un point par lot", async () => {
    const { id } = await chantier();
    const v = await ok("ficheVisite", await ok("creerVisite", id));
    expect(v.numero).toBe(1);
    expect(v.dates).toEqual([aujourdhui()]);
    expect(v.presences.map((p: { role: string }) => p.role)).toEqual(["Maître d'ouvrage", "AMO", "Lot n°01 : Maçonnerie - carrelage", "Lot n°02 : Électricité"]);
    expect(v.presences[2]).toMatchObject({ representant: "M. Durand", convoque: true, diffusion: true, etat: null });
    expect(v.points.map((p: { corpsEtat: string }) => p.corpsEtat)).toEqual(["Maçonnerie - carrelage", "Électricité"]);
  });

  test("rapport cumulatif : la visite suivante reprend avancement, suivi, constats et intervenants ; pas les observations ni les présences", async () => {
    const { id, l1 } = await chantier();
    const v1 = await ok("creerVisite", id);
    const f1 = await ok("ficheVisite", v1);
    await ok("majPresence", f1.presences[0].id, { etat: "present" });
    await ok("majPresence", f1.presences[3].id, { convoque: false });
    const pt = f1.points.find((p: { lotId: string }) => p.lotId === l1);
    await ok("majPointLot", pt.id, { avancement: 70, suivi: "Devis validé le 07/03/26", constats: "Cloison démolie", observations: "! Reprendre l'appui du châssis\n20/07 : nettoyage" });
    await ok("majVisite", v1, { dates: [aujourdhui(), "2026-01-03"], sujetsAVenir: "Point sur les travaux" });
    const f2 = await ok("ficheVisite", await ok("creerVisite", id));
    expect(f2.numero).toBe(2);
    expect(f2.sujetsAVenir).toBe("Point sur les travaux");
    expect(f2.presences[0].etat).toBeNull();
    expect(f2.presences[3].convoque).toBe(false);
    expect(f2.points.find((p: { lotId: string }) => p.lotId === l1)).toMatchObject({ avancement: 70, suivi: "Devis validé le 07/03/26", constats: "Cloison démolie", observations: null });
    expect(await erreur("majPointLot", pt.id, { avancement: 120 })).toContain("entre 0 et 100");
  });

  test("rapport envoyé : figé (présences, points, photos refusés) ; la visite suivante reste possible", async () => {
    const { id } = await chantier();
    const v = await ok("creerVisite", id);
    const f = await ok("ficheVisite", v);
    await ok("ajouterPhotosVisite", v, f.points[0].lotId, [await envoyer()]);
    expect((await ok("ficheVisite", v)).photos).toHaveLength(1);
    await ok("envoyerVisite", v);
    expect((await ok("ficheVisite", v)).statut).toBe("envoyee");
    expect(await erreur("majPresence", f.presences[0].id, { etat: "absent" })).toContain("envoyé");
    expect(await erreur("ajouterPhotosVisite", v, null, [await envoyer()])).toContain("envoyé");
    expect((await ok("listeVisites", id)).length).toBe(1);
    await ok("creerVisite", id);
    expect((await ok("listeVisites", id)).map((x: { numero: number }) => x.numero)).toEqual([2, 1]);
  });

  test("réserves par lot : constatée, levée datée, rouverte ; lot d'un autre projet refusé", async () => {
    const { id, l2 } = await chantier();
    const autre = await chantier();
    const r = await ok("creerReserve", id, { lotId: l2, description: "Prise salon à refixer" });
    expect(await erreur("creerReserve", id, { lotId: autre.l1, description: "X" })).toContain("n'appartient pas");
    await ok("leverReserve", r, aujourdhui());
    const v = await ok("ficheVisite", await ok("creerVisite", id));
    expect(v.reserves[0]).toMatchObject({ description: "Prise salon à refixer", leveeLe: aujourdhui() });
    await ok("leverReserve", r, null);
    expect((await ok("ficheVisite", v.id)).reserves[0].leveeLe).toBeNull();
  });

  test("PDF du rapport : généré avec photo (illisible ici, remplacée par sa légende), accès, observations importantes", async () => {
    const { id } = await chantier();
    await ok("majChantier", id, { numeroDossier: "20271", accesConditions: "Boîte à clés", urbanisme: { depotDp: "2025-03-10", planning: "Planning V2" } });
    await ok("majReglagesRapport", { signataire: "M. Dupont", agence: "Agence Ouest" });
    const v = await ok("creerVisite", id);
    const f = await ok("ficheVisite", v);
    await ok("majPointLot", f.points[0].id, { observations: "! Important\nNormal" });
    await ok("ajouterPhotosVisite", v, null, [await envoyer()]);
    const r = await s.requete(`/api/exports/visite/${v}`, { cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(decodeURIComponent(r.headers.get("content-disposition") ?? "")).toContain("Rapport de visite n°1.pdf");
    const octets = new Uint8Array(await r.arrayBuffer());
    expect(new TextDecoder().decode(octets.slice(0, 5))).toBe("%PDF-");
    expect((await s.requete(`/api/exports/visite/${v}`)).status).toBe(401);
  });

  test("dates de visite lisibles, comme dans le rapport Excel", () => {
    expect(datesVisite(["2026-07-03", "2026-06-29", "2026-06-30", "2026-07-09"])).toBe("29 & 30/06 et 03 & 09/07/2026");
    expect(datesVisite(["2026-07-09"])).toBe("09/07/2026");
  });
});
