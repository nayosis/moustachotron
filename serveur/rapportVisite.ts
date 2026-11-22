/*
 * Rapport de visite en PDF (docs/rapport-de-visite.md) : même structure que le rapport du tableur Excel — en-tête,
 * intervenants et présences, sujets de la réunion à venir, textes types, accès, formalités, un bloc par lot
 * (avancement, suivi, constats, observations dont les importantes en rouge, photos, réserves), approbation, signature.
 */
import { existsSync, readFileSync } from "node:fs";
import { query } from "../src/db/client";
import { ficheVisite } from "../src/data/visites";
import { dateLisible } from "../src/lib/dates";
import { cheminFichier } from "./fichiers";
import { Redacteur, type Colonne } from "./pdf";

const jj = (d: string | null | undefined) => (d ? dateLisible(d, { day: "2-digit", month: "2-digit", year: "numeric" }) : "");

/** Dates de visite lisibles : « 29 & 30/06 et 03, 06 & 09/07/2026 ». */
export function datesVisite(dates: string[]) {
  const parMois = new Map<string, string[]>();
  for (const d of [...dates].sort()) parMois.set(d.slice(0, 7), [...(parMois.get(d.slice(0, 7)) ?? []), d.slice(8, 10)]);
  const morceaux = [...parMois].map(([m, jours]) => `${jours.length > 1 ? `${jours.slice(0, -1).join(", ")} & ${jours.at(-1)}` : jours[0]}/${m.slice(5, 7)}`);
  const annee = dates.length ? [...dates].sort().at(-1)!.slice(0, 4) : "";
  return morceaux.length ? `${morceaux.join(" et ")}/${annee}` : "";
}

/** Octets d'un fichier rattaché (null s'il manque sur le disque). */
function lireFichier(nom: string | null | undefined) {
  if (!nom) return null;
  try {
    const c = cheminFichier(nom);
    return existsSync(c) ? new Uint8Array(readFileSync(c)) : null;
  } catch {
    return null;
  }
}

export async function rapportVisite(id: string) {
  const v = await ficheVisite(id);
  const p = v.projet;
  const t = v.textes;
  const moe = p.missionCode === "MOE";
  const titreRapport = `Rapport ${moe ? "de maîtrise d'œuvre" : "d'assistance à maîtrise d'ouvrage"} n°${v.numero}`;
  const r = await Redacteur.creer(`${p.intitule} — ${titreRapport}`, `${v.agence || "Rapport de visite"} · ${p.clientNom} · ${titreRapport}`);

  // Coordonnées des intervenants (téléphone, e-mail) et dates des jalons du chantier.
  const contacts = new Map(
    (await query("select id, telephone, email from contact where id in (select contact_id from presence where visite_id = ?)", [id])).map(([cid, tel, mail]) => [
      String(cid),
      { tel: (tel as string | null) ?? "", mail: (mail as string | null) ?? "" },
    ]),
  );
  const jalons = new Map((await query("select code, coalesce(date_reelle, date_prevue) from jalon where projet_id = ?", [p.id])).map(([c, d]) => [String(c), (d as string | null) ?? ""]));

  // --- En-tête
  r.titre(p.intitule.toUpperCase(), 15);
  r.texte([p.numeroDossier ? `N° ${p.numeroDossier}` : "", p.adresse ?? ""].filter(Boolean).join(" – "), { gras: true });
  r.bandeau(titreRapport.toUpperCase(), `VISITES DU : ${datesVisite(v.dates)}`);

  // --- Intervenants
  const colonnes: Colonne[] = [
    { titre: "Corps d'état", largeur: 140 },
    { titre: "Représenté par", largeur: 100 },
    { titre: "P", largeur: 16 },
    { titre: "A", largeur: 16 },
    { titre: "R", largeur: 16 },
    { titre: "E", largeur: 16 },
    { titre: "Conv.", largeur: 30 },
    { titre: "Diff.", largeur: 28 },
    { titre: "Téléphone / e-mail", largeur: 133 },
  ];
  const x = (b: boolean) => (b ? "X" : "");
  r.tableau(
    colonnes,
    v.presences.map((pr) => {
      const c = pr.contactId ? contacts.get(pr.contactId) : undefined;
      return [pr.role, pr.representant ?? "", x(pr.etat === "present"), x(pr.etat === "absent"), x(pr.etat === "retard"), x(pr.etat === "excuse"), x(pr.convoque), x(pr.diffusion), [c?.tel, c?.mail].filter(Boolean).join(" · ")];
    }),
  );
  r.texte("P : présent · A : absent · R : retard · E : excusé · Conv. : convoqué au prochain rendez-vous · Diff. : destinataire du rapport", { taille: 7, gris: true });

  // --- Sujets, note générale, textes types
  r.bandeau("PRINCIPAUX SUJETS DE LA RÉUNION À VENIR");
  r.texte(v.sujetsAVenir || "—", { gras: true });
  if (v.noteGenerale) {
    r.bandeau("NOTE GÉNÉRALE");
    r.texte(v.noteGenerale);
  }
  r.bandeau("I – RÉUNION DE CHANTIER");
  if (t.reunion) r.texte(t.reunion, { gras: true });
  r.bandeau("II – POINTS GÉNÉRAUX – MODALITÉS D'ACCÈS AU CHANTIER");
  if (t.pointsGeneraux) r.texte(t.pointsGeneraux);
  r.espace(4);
  r.champs([
    ["Adresse du chantier", p.adresse ?? ""],
    ["Stationnement", p.accesStationnement ?? ""],
    ["Stockage provisoire", p.accesStockage ?? ""],
  ]);
  if (p.accesConditions) {
    r.texte("Conditions d'accès – clés, codes, horaires :", { gras: true });
    r.texte(p.accesConditions, { rouge: true, gras: true });
  }
  for (const [titre, cle] of [
    ["Nettoyage du chantier", "nettoyage"],
    ["Sous-traitance", "sousTraitance"],
    ["Facturation", "facturation"],
    ["Plans d'exécution et de réservations", "plans"],
  ] as const) {
    if (!t[cle]) continue;
    r.espace(3);
    r.texte(`${titre} :`, { gras: true });
    r.texte(t[cle]);
  }

  // --- Formalités
  r.bandeau("III – DÉLAI D'EXÉCUTION – PLANNING – FORMALITÉS ADMINISTRATIVES");
  const u = p.urbanisme;
  if (u.planning) r.texte(u.planning, { gras: true });
  r.champs([
    ["Dépôt DP", jj(u.depotDp)],
    ["Acceptation DP", jj(u.acceptationDp)],
    ["Affichage", jj(u.affichage)],
    ["Arrêté DP", u.arreteDp ?? ""],
    ["DOC déposée le", jj(u.docDeposee)],
    ["Début des travaux", jj(jalons.get("demarrage_travaux"))],
    ["Réception", jj(jalons.get("reception_travaux"))],
    ["Levée de réserves", jj(jalons.get("reserves_levees"))],
    ["DAACT déposée le", jj(u.daactDeposee)],
  ]);
  if (u.prescriptions) {
    r.texte("Prescriptions DP :", { gras: true });
    r.texte(u.prescriptions);
  }
  for (const [titre, cle] of [
    ["IV – CHOIX DES MATÉRIAUX / ÉCHANTILLONS", "materiaux"],
    ["V – APPROVISIONNEMENTS", "approvisionnements"],
    ["VI – PRÉ-RÉCEPTION – RÉCEPTION – LEVÉE DES RÉSERVES – DOSSIER DE FIN DE CHANTIER", "reception"],
    ["À TOUTES LES ENTREPRISES", "toutesEntreprises"],
    ["SÉCURITÉ SUR LE CHANTIER", "securite"],
  ] as const) {
    if (!t[cle]) continue;
    r.bandeau(titre);
    r.texte(t[cle]);
  }

  // --- Un bloc par lot
  const photosDe = (lotId: string | null) =>
    v.photos
      .filter((ph) => ph.lotId === lotId)
      .flatMap((ph) => {
        const octets = lireFichier(ph.fichier);
        return octets ? [{ octets, mime: ph.mime, legende: ph.nom }] : [];
      });
  for (const pt of v.points) {
    r.bandeau(`Lot ${String(pt.numero).padStart(2, "0")} : ${pt.corpsEtat.toUpperCase()}`, `${pt.entrepriseNom ?? ""}${pt.avancement != null ? ` — AVANCEMENT ${pt.avancement} %` : ""}`);
    if (pt.suivi || pt.constats) {
      r.texte("Avancement", { gras: true });
      if (pt.suivi) r.texte(pt.suivi, { gris: true });
      if (pt.constats) r.texte(pt.constats);
    }
    if (pt.observations) {
      r.espace(3);
      r.texte("Observations :", { gras: true });
      for (const ligne of pt.observations.split("\n")) {
        const important = ligne.trimStart().startsWith("!");
        r.texte(important ? ligne.trimStart().slice(1).trim() : ligne, { gras: true, rouge: important });
      }
    }
    const reserves = v.reserves.filter((x) => x.lotId === pt.lotId && !x.leveeLe);
    if (reserves.length) {
      r.texte("Réserves à lever :", { gras: true, rouge: true });
      for (const x of reserves) r.texte(`– ${x.description} (constatée le ${jj(x.constateeLe)})`, { rouge: true, retrait: 8 });
    }
    const photos = photosDe(pt.lotId);
    if (photos.length) await r.photos(photos);
  }

  // --- Photos et réserves sans lot
  const generales = photosDe(null);
  if (generales.length) {
    r.bandeau("PHOTOS");
    await r.photos(generales);
  }
  const sansLot = v.reserves.filter((x) => !x.lotId && !x.leveeLe);
  if (sansLot.length) {
    r.bandeau("RÉSERVES À LEVER");
    for (const x of sansLot) r.texte(`– ${x.description} (constatée le ${jj(x.constateeLe)})`, { rouge: true });
  }

  // --- Approbation et signature
  r.bandeau("APPROBATION DU RAPPORT PRÉCÉDENT");
  if (t.approbation) r.texte(t.approbation, { taille: 8 });
  r.espace(8);
  const signature = lireFichier(v.signature);
  await r.signature(
    [`Rapport de visite établi le : ${jj(v.envoyeeLe ?? [...v.dates].sort().at(-1))}`, v.signataire ? `Par ${v.signataire}` : "", v.agence].filter(Boolean),
    signature ? { octets: signature, mime: v.signature.endsWith(".png") ? "image/png" : "image/jpeg" } : null,
  );
  return { octets: await r.terminer(), nom: `${(v.dates.at(-1) ?? "").replace(/-/g, "").slice(2)} - ${p.clientNom} - Rapport de visite n°${v.numero}.pdf` };
}
