/*
 * Contacts, projets, jalons, lots, devis, tranches, relances, documents : chaque règle de docs/conception.md
 * (phase 1) a son test, passé par l'API (droits compris).
 */
import { describe, expect, test } from "bun:test";
import { aujourdhui } from "../src/lib/dates";
import { SUPER, serveurDeTest } from "./outils-serveur";

const s = await serveurDeTest();
const { cookie } = await s.connexion(SUPER.email, SUPER.motDePasse);
const lecteur = await s.compte("lecture@cabinet.fr", "lecture");

const appel = async (nom: string, args: unknown[], c = cookie) => {
  const r = await s.rpc(nom, args, c);
  const corps = await r.json();
  return { statut: r.status, resultat: corps.resultat, erreur: corps.erreur as string | undefined };
};
const ok = async (nom: string, ...args: unknown[]) => {
  const r = await appel(nom, args);
  if (r.statut !== 200) throw new Error(`${nom} : ${r.statut} ${r.erreur}`);
  return r.resultat;
};
const erreur = async (nom: string, ...args: unknown[]) => (await appel(nom, args)).erreur;
const envoyer = async (nom = "devis.pdf", type = "application/pdf") => {
  const f = new FormData();
  f.append("fichier", new File([new Uint8Array([37, 80, 68, 70])], nom, { type }));
  const r = await s.app.handle(new Request("http://local/api/fichiers", { method: "POST", body: f, headers: { "x-app": "1", cookie } }));
  return (await r.json()) as { fichier: string; nom: string };
};
/** Date à N jours d'aujourd'hui (négatif : passé). */
const jour = (n: number) => {
  const d = new Date(`${aujourdhui()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const entreprise = (nom: string, corpsEtat: string) => ok("creerContact", { type: "entreprise", nom, corpsEtat });
const nouveauProjet = (nom = "Famille Martin", missionCode = "AMO") =>
  ok("creerProjet", { intitule: "Rénovation maison 1930", missionCode, origineCode: "reseau", nouveauClient: { nom } }) as Promise<string>;

describe("projets", () => {
  test("création avec un nouveau prospect : client créé, référence de l'année, jalon de réception daté ; prospect jusqu'à la mission validée", async () => {
    const id = await nouveauProjet();
    const p = await ok("ficheProjet", id);
    expect(p.reference).toBe(`${aujourdhui().slice(0, 4)}-001`);
    expect(p.client).toMatchObject({ nom: "Famille Martin", type: "client" });
    expect(p.jalon.code).toBe("reception_prospect");
    expect(p.jalons.find((j: { code: string }) => j.code === "reception_prospect").dateReelle).toBe(aujourdhui());
    const prospect = async () => (await ok("listeContacts", { type: "client" })).find((c: { id: string }) => c.id === p.clientId).prospect;
    expect(await prospect()).toBe(true);
    await ok("fixerJalon", id, "validation_mission", { dateReelle: aujourdhui() });
    expect(await prospect()).toBe(false);
    expect((await ok("ficheProjet", id)).jalon.code).toBe("validation_mission");
  });

  test("contrôles : mission archivée (audit), client qui n'est pas un client, date réelle future, jalon d'une autre mission", async () => {
    expect(await erreur("creerProjet", { intitule: "X", missionCode: "AUD", origineCode: "site", nouveauClient: { nom: "Y" } })).toBe("Cette mission n'est plus proposée.");
    const e = await entreprise("Élec Ouest", "Électricité");
    expect(await erreur("creerProjet", { intitule: "X", missionCode: "AMO", origineCode: "site", clientId: e })).toBe("Le client d'un projet doit être un contact de type client.");
    const id = await nouveauProjet("Famille Roux");
    expect(await erreur("fixerJalon", id, "contact", { dateReelle: jour(3) })).toContain("ne peut pas être dans le futur");
    await ok("fixerJalon", id, "contact", { datePrevue: jour(3) });
    expect(await erreur("fixerJalon", id, "remise_rapport", { dateReelle: jour(0) })).toBe("Jalon inconnu pour cette mission.");
    expect(await erreur("fixerJalon", id, "validation_devis", { dateReelle: jour(0) })).toContain("Valider les devis");
  });

  test("lot et devis : versions automatiques, le devis retenu fixe montant et entreprise du lot, honoraires calculés", async () => {
    const id = await nouveauProjet("Famille Besson");
    const e1 = await entreprise("Pierre & Chaux", "Maçonnerie");
    const e2 = await entreprise("Bâti 17", "Maçonnerie");
    const lot = await ok("creerLot", id, { corpsEtat: "Maçonnerie" });
    const d1 = await ok("creerDevis", lot, { entrepriseId: e1, date: jour(-5), montantTtc: 2_640_000 }, [await envoyer()]);
    const d2 = await ok("creerDevis", lot, { entrepriseId: e1, date: jour(-2), montantTtc: 2_465_000 });
    await ok("creerDevis", lot, { entrepriseId: e2, date: jour(-1), montantTtc: 2_700_000 });
    let p = await ok("ficheProjet", id);
    expect(p.lots[0].devis.map((d: { version: number }) => d.version)).toEqual([1, 2, 1]);
    expect(p.documents.filter((d: { devisId: string }) => d.devisId === d1)).toHaveLength(1);
    await ok("retenirDevis", d1);
    await ok("retenirDevis", d2);
    p = await ok("ficheProjet", id);
    expect(p.lots[0]).toMatchObject({ montantTtc: 2_465_000, entrepriseId: e1, commissionPb: 1300 });
    expect(p.lots[0].devis.filter((d: { statut: string }) => d.statut === "retenu").map((d: { id: string }) => d.id)).toEqual([d2]);
    expect(p.synthese).toMatchObject({ travauxTtc: 2_465_000, honorairesTtc: 369_750, honorairesHt: 336_136 });
    // Acompte au barème (≤ 75 k€ : 750 € TTC).
    expect(p.synthese.echeancier[0]).toMatchObject({ code: "acompte", ttc: 75_000 });
  });

  test("validation partielle des devis : les lots non validés partent dans une tranche 2 liée ; lots figés ensuite", async () => {
    const id = await nouveauProjet("Famille Lefort");
    await ok("fixerJalon", id, "reception_devis", { dateReelle: jour(-3) });
    const e = await entreprise("Multi Services", "Tous corps");
    const [l1, l2, l3] = [await ok("creerLot", id, { corpsEtat: "Maçonnerie" }), await ok("creerLot", id, { corpsEtat: "Électricité" }), await ok("creerLot", id, { corpsEtat: "Plomberie" })];
    for (const l of [l1, l2]) await ok("retenirDevis", await ok("creerDevis", l, { entrepriseId: e, date: jour(-4), montantTtc: 1_100_000 }));
    const doc = await envoyer("devis-plomberie.pdf");
    await ok("creerDevis", l3, { entrepriseId: e, date: jour(-4), montantTtc: 900_000 }, [doc]);
    expect(await erreur("validerDevis", id, [l1, l3], jour(0))).toContain("retenez d'abord un devis");
    const tranche = await ok("validerDevis", id, [l1, l2], jour(0));
    expect(typeof tranche).toBe("string");
    const p = await ok("ficheProjet", id);
    expect(p.devisValides).toBe(true);
    expect(p.jalon.code).toBe("validation_devis");
    expect(p.lots.map((l: { id: string }) => l.id)).toEqual([l1, l2]);
    expect(p.tranchesSuivantes.map((t: { id: string }) => t.id)).toEqual([tranche]);
    const t = await ok("ficheProjet", tranche);
    expect(t.intitule).toBe("Rénovation maison 1930 — tranche 2");
    expect(t.projetOrigineId).toBe(id);
    expect(t.lots.map((l: { id: string }) => l.id)).toEqual([l3]);
    expect(t.lots[0].devis).toHaveLength(1);
    expect(t.documents.map((d: { fichier: string }) => d.fichier)).toEqual([doc.fichier]);
    expect(t.jalon.code).toBe("reception_devis");
    expect(t.devisValides).toBe(false);
    // Figé : plus de lot ni de devis sur le projet validé ; perdu impossible.
    expect(await erreur("creerLot", id, { corpsEtat: "Peinture" })).toContain("avenant");
    expect(await erreur("creerDevis", l1, { entrepriseId: e, date: jour(0), montantTtc: 100 })).toContain("validés");
    expect(await erreur("cloreProjet", id, "perdu", "Trop cher")).toContain("engagé");
    expect(await erreur("validerDevis", id, [l1], jour(0))).toContain("déjà validés");
  });

  test("perdu avec motif obligatoire, puis rouvert", async () => {
    const id = await nouveauProjet("Famille Picard");
    expect(await erreur("cloreProjet", id, "perdu", " ")).toBe("Motif : obligatoire.");
    await ok("cloreProjet", id, "perdu", "Concurrent moins cher");
    expect((await ok("listeProjets", { issue: "perdu" })).some((p: { id: string }) => p.id === id)).toBe(true);
    expect((await ok("listeProjets")).some((p: { id: string }) => p.id === id)).toBe(false);
    await ok("rouvrirProjet", id);
    expect((await ok("ficheProjet", id)).issue).toBe("en_cours");
  });

  test("EAA : forfait 199 € TTC, payé à la remise du rapport ; pas de lots", async () => {
    const id = await nouveauProjet("M. Vidal", "EAA");
    const p = await ok("ficheProjet", id);
    expect(p.synthese.echeancier).toEqual([{ code: "solde", libelle: "100 % à la livraison du rapport", jalon: "remise_rapport", ttc: 19_900, ht: 16_583 }]);
    expect(p.jalons.some((j: { code: string }) => j.code === "lancement_consultation")).toBe(false);
    expect(await erreur("creerLot", id, { corpsEtat: "X" })).toBe("Cette mission n'a pas de lots de travaux.");
  });

  test("apporteur : commission d'apport de 10 % par défaut", async () => {
    const a = await ok("creerContact", { type: "apporteur", nom: "Agence Duval" });
    const id = await ok("creerProjet", { intitule: "Maison", missionCode: "AMO", origineCode: "apporteur", apporteurId: a, nouveauClient: { nom: "Famille Hamon" } });
    expect((await ok("ficheProjet", id)).tauxApportPb).toBe(1000);
  });
});

describe("échanges et relances", () => {
  test("relance due listée puis faite ; contact qui n'intervient pas sur le projet refusé ; même saisie reçue deux fois = une seule", async () => {
    const id = await nouveauProjet("Famille Carpentier");
    const p = await ok("ficheProjet", id);
    const i = await ok("creerInteraction", { contactId: p.clientId, projetId: id, nature: "appel", date: jour(-1), objet: "Rappeler pour la visite", aFaireLe: jour(0) });
    expect((await ok("listeRelances")).map((r: { id: string }) => r.id)).toContain(i);
    await ok("marquerFaite", i, true);
    expect((await ok("listeRelances")).map((r: { id: string }) => r.id)).not.toContain(i);
    const autre = await ok("creerContact", { type: "client", nom: "Inconnu" });
    expect(await erreur("creerInteraction", { contactId: autre, projetId: id, nature: "note", date: jour(0), objet: "X" })).toBe("Ce contact n'intervient pas sur ce projet.");
    const idAppareil = "0b9d5f8e-1111-4c3a-9e2f-123456789abc";
    const saisie = { contactId: p.clientId, nature: "note", date: jour(0), objet: "Saisie terrain" };
    await ok("creerInteraction", saisie, idAppareil);
    await ok("creerInteraction", saisie, idAppareil);
    expect((await ok("ficheContact", p.clientId)).interactions.filter((x: { id: string }) => x.id === idAppareil)).toHaveLength(1);
  });

  test("estimation remise depuis plus de 15 jours sans nouvelles : à relancer", async () => {
    const id = await nouveauProjet("Famille Morel");
    await ok("fixerJalon", id, "estimation", { dateReelle: jour(-20) });
    expect((await ok("projetsSansNouvelles")).map((p: { id: string }) => p.id)).toContain(id);
    await ok("fixerJalon", id, "validation_mission", { dateReelle: jour(0) });
    expect((await ok("projetsSansNouvelles")).map((p: { id: string }) => p.id)).not.toContain(id);
  });
});

describe("documents", () => {
  test("attestation d'assurance : fin de validité exigée, alerte à moins de 30 jours", async () => {
    const e = await entreprise("Couverture 17", "Couverture");
    expect(await erreur("ajouterDocuments", { contactId: e }, "attestation_assurance", [await envoyer("attestation.pdf")])).toContain("fin de validité");
    await ok("ajouterDocuments", { contactId: e }, "attestation_assurance", [await envoyer("attestation.pdf")], jour(10));
    expect((await ok("attestationsAEcheance")).find((a: { id: string }) => a.id === e)).toMatchObject({ fin: jour(10), expiree: false });
    // Une attestation renouvelée fait disparaître l'alerte.
    await ok("ajouterDocuments", { contactId: e }, "attestation_assurance", [await envoyer("attestation-2027.pdf")], jour(365));
    expect((await ok("attestationsAEcheance")).some((a: { id: string }) => a.id === e)).toBe(false);
  });

  test("Word et Excel acceptés ; type de document inconnu refusé", async () => {
    const id = await nouveauProjet("Famille Thomas");
    const docx = await envoyer("descriptif.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(docx.fichier.endsWith(".docx")).toBe(true);
    expect(await erreur("ajouterDocuments", { projetId: id }, "inconnu", [docx])).toBe("Type de document inconnu.");
    await ok("ajouterDocuments", { projetId: id }, "descriptif", [docx]);
    expect((await ok("ficheProjet", id)).documents).toHaveLength(1);
  });
});

describe("droits et journal", () => {
  test("le rôle lecture lit mais n'écrit pas ; la validation des devis est journalisée avec le projet avant / après", async () => {
    expect((await appel("listeProjets", [], lecteur.cookie)).statut).toBe(200);
    expect((await appel("creerContact", [{ type: "client", nom: "Non" }], lecteur.cookie)).statut).toBe(403);
    const id = await nouveauProjet("Famille Garnier");
    const e = await entreprise("Plomberie Ouest", "Plomberie");
    const l = await ok("creerLot", id, { corpsEtat: "Plomberie" });
    await ok("retenirDevis", await ok("creerDevis", l, { entrepriseId: e, date: jour(0), montantTtc: 980_000 }));
    await ok("validerDevis", id, [l], jour(0));
    const { lignes } = await (await s.requete(`/api/journal?cible=${id}`, { cookie })).json();
    const v = lignes.find((x: { fonction: string }) => x.fonction === "validerDevis");
    expect(JSON.parse(v.apres).jalons.some((j: { code: string; date_reelle: string }) => j.code === "validation_devis" && j.date_reelle === jour(0))).toBe(true);
  });
});

describe("pipeline", () => {
  test("le prochain jalon annoncé vient après le jalon courant (un jalon sauté ne s'annonce plus)", async () => {
    const id = await nouveauProjet("Famille Renaud");
    await ok("fixerJalon", id, "reception_devis", { datePrevue: jour(5) });
    const prochain = async () => (await ok("listeProjets")).find((p: { id: string }) => p.id === id).prochain;
    expect((await prochain()).code).toBe("reception_devis");
    await ok("fixerJalon", id, "lancement_projet", { dateReelle: jour(0) });
    await ok("fixerJalon", id, "demarrage_travaux", { datePrevue: jour(9) });
    expect(await prochain()).toMatchObject({ code: "demarrage_travaux", date: jour(9), enRetard: false });
  });
});
