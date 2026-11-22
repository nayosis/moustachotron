/*
 * Lots d'un projet et devis des entreprises (plusieurs devis par lot, plusieurs versions ; un seul retenu, qui
 * fixe le montant et l'entreprise du lot). Conception § Montants d'un projet et § Fichiers et documents.
 * Une fois les devis validés, les lots et devis ne changent plus ici (les avenants viendront avec la trésorerie).
 */
import { and, eq } from "drizzle-orm";
import { batch, db, newId, query, type Statement } from "../db/client";
import { lot } from "../db/schema";
import { ErreurMetier } from "../../serveur/erreurs";
import { DATE, exiger, instructionsDocuments, montant, parametre, taux, texteLibre, texteObligatoire, type FichierARattacher } from "./_commun";
import { sansTrace, verifierVersion, versionDe } from "./_version";

export type SaisieLot = { corpsEtat: string; entrepriseId?: string | null; tvaPb?: number; commissionPb?: number };
export type SaisieDevis = { entrepriseId: string; reference?: string | null; date: string; montantTtc: number; version?: number | null };

// --- Contrôles

/** Le projet d'un lot, et si ses devis sont déjà validés (lots et devis figés). */
async function projetDuLot(lotId: string) {
  const [l] = await query(
    `select l.projet_id, exists (select 1 from jalon j where j.projet_id = l.projet_id and j.code = 'validation_devis' and j.date_reelle is not null)
     from lot l where l.id = ?`,
    [lotId],
  );
  if (!l) throw new ErreurMetier("Lot introuvable.", 404);
  return { projetId: String(l[0]), fige: !!l[1] };
}

async function verifierModifiable(lotId: string) {
  const p = await projetDuLot(lotId);
  if (p.fige) throw new ErreurMetier("Les devis de ce projet sont validés : lots et devis ne se modifient plus (un changement sera un avenant).");
  return p;
}

async function verifierEntreprise(id: string | null | undefined) {
  if (!id) return;
  const [l] = await query("select type from contact where id = ?", [id]);
  if (!l) throw new ErreurMetier("Entreprise introuvable.", 404);
  if (l[0] !== "entreprise") throw new ErreurMetier("Ce contact n'est pas une entreprise.");
}

function verifierLot(v: Partial<SaisieLot>) {
  if (v.corpsEtat !== undefined) texteObligatoire(v.corpsEtat, "Corps d'état");
  taux(v.tvaPb, "TVA");
  taux(v.commissionPb, "Commission");
}

// --- Écriture : lots

/** Nouveau lot (numéro suivant du projet, commission par défaut des réglages). Renvoie son id. */
export async function creerLot(projetId: string, v: SaisieLot) {
  await exiger("projet", projetId, "Projet");
  const [m] = await query("select m.avec_travaux from projet p join mission m on m.code = p.mission_code where p.id = ?", [projetId]);
  if (!m[0]) throw new ErreurMetier("Cette mission n'a pas de lots de travaux.");
  const [fige] = await query("select 1 from jalon where projet_id = ? and code = 'validation_devis' and date_reelle is not null", [projetId]);
  if (fige) throw new ErreurMetier("Les devis de ce projet sont validés : un nouveau lot sera un avenant.");
  verifierLot(v);
  await verifierEntreprise(v.entrepriseId);
  const [n] = await query("select coalesce(max(numero), 0) + 1 from lot where projet_id = ?", [projetId]);
  const id = newId();
  await db.insert(lot).values({
    id,
    projetId,
    numero: Number(n[0]),
    corpsEtat: texteObligatoire(v.corpsEtat, "Corps d'état"),
    entrepriseId: v.entrepriseId || null,
    tvaPb: v.tvaPb ?? 1000,
    commissionPb: v.commissionPb ?? (await parametre<number>("commission_defaut_pb", 1300)),
  });
  return id;
}

/** Modifie un lot (avant validation des devis). */
export async function majLot(id: string, patch: Partial<SaisieLot>, version?: string | null) {
  await verifierModifiable(id);
  await verifierVersion("lot", id, version);
  const v = sansTrace(patch);
  verifierLot(v);
  await verifierEntreprise(v.entrepriseId);
  await db
    .update(lot)
    .set({
      ...(v.corpsEtat !== undefined ? { corpsEtat: v.corpsEtat.trim() } : {}),
      ...(v.entrepriseId !== undefined ? { entrepriseId: v.entrepriseId || null } : {}),
      ...(v.tvaPb !== undefined ? { tvaPb: v.tvaPb } : {}),
      ...(v.commissionPb !== undefined ? { commissionPb: v.commissionPb } : {}),
    })
    .where(eq(lot.id, id));
  return versionDe("lot", id);
}

/** Retire un lot (avant validation des devis) : archivé, il reste dans le journal. */
export async function archiverLot(id: string) {
  await verifierModifiable(id);
  await query("update lot set archive = 1 where id = ?", [id]);
}

// --- Écriture : devis

/**
 * Nouveau devis reçu pour un lot, avec son fichier éventuel. Sans version donnée : la suivante pour la même
 * entreprise sur ce lot (v1, v2…). Renvoie son id.
 */
export async function creerDevis(lotId: string, v: SaisieDevis, fichiers: FichierARattacher[] = []) {
  const { projetId } = await verifierModifiable(lotId);
  await verifierEntreprise(v.entrepriseId);
  if (!v.entrepriseId) throw new ErreurMetier("Entreprise : obligatoire.");
  if (!DATE.test(v.date ?? "")) throw new ErreurMetier("Date du devis invalide.");
  const m = montant(v.montantTtc, "Montant TTC", true)!;
  if (m === 0) throw new ErreurMetier("Montant TTC : doit être supérieur à zéro.");
  let version = v.version ?? null;
  if (version == null) {
    const [n] = await query("select coalesce(max(version), 0) + 1 from devis where lot_id = ? and entreprise_id = ?", [lotId, v.entrepriseId]);
    version = Number(n[0]);
  }
  if (!Number.isInteger(version) || version < 1) throw new ErreurMetier("Version invalide.");
  const id = newId();
  const sts: Statement[] = [
    {
      sql: "insert into devis (id, lot_id, entreprise_id, reference, version, date, montant_ttc) values (?, ?, ?, ?, ?, ?, ?)",
      params: [id, lotId, v.entrepriseId, texteLibre(v.reference), version, v.date, m],
    },
  ];
  if (fichiers.length) sts.push(...(await instructionsDocuments(fichiers, { projetId, lotId, devisId: id }, "devis")));
  await batch(sts);
  return id;
}

/** Retient un devis : il fixe le montant et l'entreprise du lot ; l'ancien devis retenu redevient « reçu ». */
export async function retenirDevis(id: string) {
  const [d] = await query("select lot_id, entreprise_id, montant_ttc, archive from devis where id = ?", [id]);
  if (!d) throw new ErreurMetier("Devis introuvable.", 404);
  if (d[3]) throw new ErreurMetier("Ce devis est retiré.");
  const lotId = String(d[0]);
  await verifierModifiable(lotId);
  await batch([
    { sql: "update devis set statut = 'recu' where lot_id = ? and statut = 'retenu' and id <> ?", params: [lotId, id] },
    { sql: "update devis set statut = 'retenu' where id = ?", params: [id] },
    { sql: "update lot set montant_ttc = ?, entreprise_id = ? where id = ?", params: [d[2], d[1], lotId] },
  ]);
}

/** Écarte un devis (refusé). S'il était retenu, le lot n'a plus de montant. */
export async function refuserDevis(id: string) {
  const [d] = await query("select lot_id, statut from devis where id = ?", [id]);
  if (!d) throw new ErreurMetier("Devis introuvable.", 404);
  await verifierModifiable(String(d[0]));
  const sts: Statement[] = [{ sql: "update devis set statut = 'refuse' where id = ?", params: [id] }];
  if (d[1] === "retenu") sts.push({ sql: "update lot set montant_ttc = null where id = ?", params: [d[0]] });
  await batch(sts);
}

/** Retire un devis saisi par erreur : archivé (reste dans le journal). */
export async function archiverDevis(id: string) {
  const [d] = await query("select lot_id, statut from devis where id = ?", [id]);
  if (!d) throw new ErreurMetier("Devis introuvable.", 404);
  await verifierModifiable(String(d[0]));
  const sts: Statement[] = [{ sql: "update devis set archive = 1, statut = case when statut = 'retenu' then 'recu' else statut end where id = ?", params: [id] }];
  if (d[1] === "retenu") sts.push({ sql: "update lot set montant_ttc = null where id = ?", params: [d[0]] });
  await batch(sts);
}

/** Lots d'un projet (pour les listes de choix). */
export async function lotsDuProjet(projetId: string) {
  return db.select().from(lot).where(and(eq(lot.projetId, projetId), eq(lot.archive, false)));
}
