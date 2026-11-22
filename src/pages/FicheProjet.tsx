import { useEffect, useState } from "react";
import {
  ActionIcon, Alert, Anchor, Badge, Button, Card, Checkbox, FileButton, Group, Menu, Modal, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title, Tooltip,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconArchive, IconArrowLeft, IconCheck, IconDots, IconFileText, IconPencil, IconPlus, IconTrash, IconX,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { archiverDevis, archiverLot, creerDevis, creerLot, majLot, refuserDevis, retenirDevis } from "../data/lots";
import { archiverProjet, cloreProjet, ficheProjet, fixerJalon, majProjet, referentiels, rouvrirProjet, validerDevis } from "../data/projets";
import { ChampDate } from "../components/Champs";
import { ListeDocuments, ModalDocument, TYPES_ACCEPTES, envoyerTous } from "../components/Documents";
import { TableEcheances } from "../components/Echeances";
import { SuiviChantier } from "../components/SuiviChantier";
import { apercuEcheances, planifierEcheances } from "../data/echeances";
import { ModalEchange, useOptionsContacts } from "../components/Formulaires";
import { Historique } from "../components/Historique";
import { aujourdhui, dateLisible } from "../lib/dates";
import { TYPES_DOCUMENTS } from "../lib/documents";
import { useEcran } from "../lib/ecran";
import { urlFichier } from "../lib/fichiers";
import { COULEUR_STATUT_DEVIS, LIBELLES_ISSUE, LIBELLES_NATURE, LIBELLES_STATUT_DEVIS } from "../lib/libelles";
import { euros, lireMontant } from "../lib/montants";
import { commissionLot, htDepuisTtc, lirePourcent, pourcent, TVA_TRAVAUX } from "../lib/prix";
import { ecrire } from "../lib/query";
import { estAdmin, peutEcrire } from "../lib/session";
import { ficheProjetRoute } from "../router";

type Fiche = Awaited<ReturnType<typeof ficheProjet>>;
type LotFiche = Fiche["lots"][number];
const court = (d: string | null) => (d ? dateLisible(d, { day: "numeric", month: "short", year: "numeric" }) : "");
const montantSaisi = (c: number | null | undefined) => (c == null ? "" : (c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2 }).replace(/\s/g, " "));

// --- Fenêtres

/** Modifier le projet : intitulé, adresse, origine, apporteur, taux ou forfait, commission d'apport, notes. */
function ModalModifier({ p, opened, onClose }: { p: Fiche; opened: boolean; onClose: () => void }) {
  const { data: ref } = useQuery({ queryKey: ["referentiels"], queryFn: () => referentiels() });
  const apporteurs = useOptionsContacts(["apporteur", "partenaire", "client", "autre"]);
  const [v, setV] = useState({ intitule: "", adresse: "", origineCode: "", missionCode: "", apporteurId: null as string | null, taux: "", forfait: "", apport: "", estimation: "", notes: "" });
  useEffect(() => {
    if (opened)
      setV({
        intitule: p.intitule,
        adresse: p.adresse ?? "",
        origineCode: p.origineCode,
        missionCode: p.missionCode,
        apporteurId: p.apporteurId,
        taux: p.tauxPb == null ? "" : String(p.tauxPb / 100).replace(".", ","),
        forfait: montantSaisi(p.forfaitTtc),
        apport: p.tauxApportPb == null ? "" : String(p.tauxApportPb / 100).replace(".", ","),
        estimation: montantSaisi(p.estimationTtc),
        notes: p.notes ?? "",
      });
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const taux = v.taux.trim() ? lirePourcent(v.taux) : null;
  const forfait = v.forfait.trim() ? lireMontant(v.forfait) : null;
  const apport = v.apport.trim() ? lirePourcent(v.apport) : null;
  const estimation = v.estimation.trim() ? lireMontant(v.estimation) : null;
  const erreur = (v.taux.trim() && taux == null) || (v.forfait.trim() && forfait == null) || (v.apport.trim() && apport == null) || (v.estimation.trim() && estimation == null);
  const enregistrer = async () => {
    const r = await ecrire(() =>
      majProjet(
        p.id,
        { intitule: v.intitule, adresse: v.adresse, origineCode: v.origineCode, missionCode: v.missionCode, apporteurId: v.apporteurId, tauxPb: taux, forfaitTtc: forfait, tauxApportPb: v.apporteurId ? apport : null, estimationTtc: estimation, notes: v.notes },
        p.modifieLe,
      ),
    );
    if (r) onClose();
  };
  const pctMission = p.mission.mode === "pourcentage";
  return (
    <Modal opened={opened} onClose={onClose} title={`Modifier le projet ${p.reference}`} size="lg">
      <Stack>
        <TextInput label="Intitulé" required value={v.intitule} onChange={(e) => setV({ ...v, intitule: e.currentTarget.value })} />
        <TextInput label="Adresse du chantier" value={v.adresse} onChange={(e) => setV({ ...v, adresse: e.currentTarget.value })} />
        <Group grow>
          <Select
            label="Mission"
            data={(ref?.missions ?? []).filter((m) => !m.archive || m.code === p.missionCode).map((m) => ({ value: m.code, label: m.libelle }))}
            value={v.missionCode}
            onChange={(x) => x && setV({ ...v, missionCode: x })}
            allowDeselect={false}
            disabled={p.jalons.some((j) => j.code === "validation_mission" && j.dateReelle)}
          />
          <Select label="Origine" data={(ref?.origines ?? []).map((o) => ({ value: o.code, label: o.libelle }))} value={v.origineCode} onChange={(x) => x && setV({ ...v, origineCode: x })} allowDeselect={false} />
        </Group>
        <Group grow align="flex-start">
          {pctMission && (
            <TextInput label="Taux d'honoraires (%)" description={`Vide : ${pourcent(p.mission.tauxPb)} (mission)`} value={v.taux} onChange={(e) => setV({ ...v, taux: e.currentTarget.value })} />
          )}
          <TextInput
            label="Forfait TTC (€)"
            description={pctMission ? "Remplace le pourcentage s'il est saisi" : p.mission.forfaitTtc ? `Vide : ${euros(p.mission.forfaitTtc)} (mission)` : "Montant de la mission"}
            value={v.forfait}
            onChange={(e) => setV({ ...v, forfait: e.currentTarget.value })}
          />
        </Group>
        {p.mission.avecTravaux && (
          <TextInput
            label="Estimation des travaux TTC (€)"
            description="Celle remise au client : sert à l'acompte et au prévisionnel tant qu'aucun devis n'est retenu"
            value={v.estimation}
            onChange={(e) => setV({ ...v, estimation: e.currentTarget.value })}
          />
        )}
        <Select label="Apporteur" searchable clearable data={apporteurs} value={v.apporteurId} onChange={(x) => setV({ ...v, apporteurId: x })} />
        {v.apporteurId && <TextInput label="Commission d'apport (% des honoraires HT)" description="Vide : pas de commission" value={v.apport} onChange={(e) => setV({ ...v, apport: e.currentTarget.value })} />}
        <Textarea label="Notes" autosize minRows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.currentTarget.value })} />
        {erreur && <Alert color="red">Un taux ou un montant est illisible (exemples : « 12,75 », « 1 250,00 »).</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={enregistrer} disabled={!v.intitule.trim() || !!erreur}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Nouveau lot ou modification : corps d'état, entreprise, TVA des travaux, commission. */
function ModalLot({ projetId, lot, opened, onClose, commissionDefaut }: { projetId: string; lot: LotFiche | null; opened: boolean; onClose: () => void; commissionDefaut: number }) {
  const entreprises = useOptionsContacts(["entreprise"]);
  const [corpsEtat, setCorps] = useState("");
  const [entrepriseId, setEntreprise] = useState<string | null>(null);
  const [tva, setTva] = useState("1000");
  const [commission, setCommission] = useState("");
  useEffect(() => {
    if (!opened) return;
    setCorps(lot?.corpsEtat ?? "");
    setEntreprise(lot?.entrepriseId ?? null);
    setTva(String(lot?.tvaPb ?? 1000));
    setCommission(String((lot?.commissionPb ?? commissionDefaut) / 100).replace(".", ","));
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = lirePourcent(commission);
  const enregistrer = async () => {
    const v = { corpsEtat, entrepriseId, tvaPb: Number(tva), commissionPb: c! };
    const r = lot ? await ecrire(() => majLot(lot.id, v, lot.modifieLe)) : await ecrire(() => creerLot(projetId, v));
    if (r) onClose();
  };
  return (
    <Modal opened={opened} onClose={onClose} title={lot ? `Lot ${lot.numero}` : "Nouveau lot"}>
      <Stack>
        <TextInput label="Corps d'état" required placeholder="Maçonnerie - carrelage" value={corpsEtat} onChange={(e) => setCorps(e.currentTarget.value)} data-autofocus />
        <Select label="Entreprise pressentie" description="Fixée par le devis retenu" searchable clearable data={entreprises} value={entrepriseId} onChange={setEntreprise} />
        <Group grow>
          <Select label="TVA des travaux" data={TVA_TRAVAUX.map((t) => ({ value: String(t), label: pourcent(t) }))} value={tva} onChange={(x) => x && setTva(x)} allowDeselect={false} />
          <TextInput label="Commission (% du HT)" value={commission} onChange={(e) => setCommission(e.currentTarget.value)} error={commission && c == null ? "Illisible" : undefined} />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={enregistrer} disabled={!corpsEtat.trim() || c == null}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Devis reçu pour un lot : entreprise, référence, date, montant TTC, fichier. */
function ModalDevis({ lot, opened, onClose }: { lot: LotFiche | null; opened: boolean; onClose: () => void }) {
  const entreprises = useOptionsContacts(["entreprise"]);
  const [entrepriseId, setEntreprise] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [date, setDate] = useState<string | null>(aujourdhui());
  const [montant, setMontant] = useState("");
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    if (!opened) return;
    setEntreprise(lot?.entrepriseId ?? null);
    setReference("");
    setDate(aujourdhui());
    setMontant("");
    setFichiers([]);
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = lireMontant(montant);
  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const envoyes = await envoyerTous(fichiers);
      if (envoyes.length !== fichiers.length) return;
      const id = await ecrire(() => creerDevis(lot!.id, { entrepriseId: entrepriseId!, reference, date: date!, montantTtc: m! }, envoyes));
      if (id) onClose();
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} title={lot ? `Devis — lot ${lot.numero} : ${lot.corpsEtat}` : "Devis"}>
      <Stack>
        <Select label="Entreprise" required searchable data={entreprises} value={entrepriseId} onChange={setEntreprise} nothingFoundMessage="Créez d'abord l'entreprise dans Contacts" />
        <Group grow>
          <TextInput label="Référence" placeholder="D-2026-118" value={reference} onChange={(e) => setReference(e.currentTarget.value)} />
          <ChampDate label="Date" required value={date} onChange={setDate} />
        </Group>
        <TextInput
          label="Montant TTC (€)"
          required
          value={montant}
          onChange={(e) => setMontant(e.currentTarget.value)}
          error={montant && m == null ? "Montant illisible" : undefined}
          description={m && lot ? `${euros(htDepuisTtc(m, lot.tvaPb))} HT à ${pourcent(lot.tvaPb)}` : "Une nouvelle version d'un devis s'ajoute comme un nouveau devis (v2, v3…)"}
        />
        <FileButton onChange={setFichiers} accept={TYPES_ACCEPTES} multiple>
          {(props) => (
            <Button {...props} variant="default">
              {fichiers.length ? fichiers.map((f) => f.name).join(", ") : "Joindre le devis (PDF…)"}
            </Button>
          )}
        </FileButton>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={enregistrer} loading={envoi} disabled={!entrepriseId || !date || !m}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Validation des devis : lots validés par le client ; les autres partent dans une tranche suivante. */
function ModalValider({ p, opened, onClose }: { p: Fiche; opened: boolean; onClose: () => void }) {
  const lots = p.lots.filter((l) => !l.archive);
  const [coches, setCoches] = useState<string[]>([]);
  const [date, setDate] = useState<string | null>(aujourdhui());
  useEffect(() => {
    if (opened) {
      setCoches(lots.filter((l) => l.montantTtc).map((l) => l.id));
      setDate(aujourdhui());
    }
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const partants = lots.filter((l) => !coches.includes(l.id));
  const valider = async () => {
    const tranche = await ecrire(() => validerDevis(p.id, coches, date!));
    if (tranche !== undefined) onClose();
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Valider les devis" size="lg">
      <Stack>
        <Text size="sm">Cochez les lots que le client a validés. Seuls les lots avec un devis retenu peuvent l'être.</Text>
        <Stack gap="xs">
          {lots.map((l) => (
            <Checkbox
              key={l.id}
              disabled={!l.montantTtc}
              checked={coches.includes(l.id)}
              onChange={(e) => setCoches(e.currentTarget.checked ? [...coches, l.id] : coches.filter((x) => x !== l.id))}
              label={`Lot ${l.numero} — ${l.corpsEtat}${l.entrepriseNom ? ` (${l.entrepriseNom})` : ""} : ${l.montantTtc ? `${euros(l.montantTtc)} TTC` : "aucun devis retenu"}`}
            />
          ))}
        </Stack>
        {partants.length > 0 && coches.length > 0 && (
          <Alert color="blue">
            {partants.length} lot{partants.length > 1 ? "s" : ""} non validé{partants.length > 1 ? "s" : ""} ({partants.map((l) => l.corpsEtat).join(", ")}) partira dans un nouveau projet « tranche » lié, avec
            leurs devis et documents, qui reste en consultation.
          </Alert>
        )}
        <ChampDate label="Devis validés le" required value={date} onChange={setDate} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={valider} disabled={!coches.length || !date}>
            Valider
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Projet perdu ou abandonné, avec son motif. */
function ModalClore({ p, opened, onClose }: { p: Fiche; opened: boolean; onClose: () => void }) {
  const [issue, setIssue] = useState<"perdu" | "abandonne">("perdu");
  const [motif, setMotif] = useState("");
  useEffect(() => {
    if (opened) setMotif("");
  }, [opened]);
  return (
    <Modal opened={opened} onClose={onClose} title={`Clore le projet ${p.reference}`}>
      <Stack>
        <Select
          label="Issue"
          data={[
            { value: "perdu", label: "Perdu (le client a choisi quelqu'un d'autre…)" },
            { value: "abandonne", label: "Abandonné (projet reporté, budget…)" },
          ]}
          value={issue}
          onChange={(x) => x && setIssue(x as "perdu")}
          allowDeselect={false}
        />
        <Textarea label="Motif" required autosize minRows={2} value={motif} onChange={(e) => setMotif(e.currentTarget.value)} data-autofocus />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button color="red" disabled={!motif.trim()} onClick={async () => (await ecrire(() => cloreProjet(p.id, issue, motif).then(() => true))) && onClose()}>
            Clore
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// --- Blocs

/** Une ligne de jalon : dates prévue et réelle, modifiables sur place (empilées sur téléphone). */
function LigneJalon({ p, j, valider, telephone }: { p: Fiche; j: Fiche["jalons"][number]; valider: () => void; telephone: boolean }) {
  const modifiable = peutEcrire() && p.issue === "en_cours";
  const dedie = j.code === "validation_devis";
  const libelle = (
    <Group gap={6} wrap="nowrap">
      {j.dateReelle ? <IconCheck size={14} color="var(--mantine-color-marque-6)" /> : <span style={{ width: 14 }} />}
      <Text size="sm" fw={p.jalon?.code === j.code ? 700 : 400} c={j.dateReelle ? undefined : "dimmed"}>
        {j.libelle}
        {j.facultatif ? " (facultatif)" : ""}
      </Text>
    </Group>
  );
  const prevue =
    modifiable && !j.dateReelle ? (
      <ChampDate label={telephone ? "Prévue" : ""} value={j.datePrevue} onChange={(d) => ecrire(() => fixerJalon(p.id, j.code, { datePrevue: d }))} />
    ) : (
      <Text size="sm" c="dimmed">
        {j.datePrevue ? `${telephone ? "prévue " : ""}${court(j.datePrevue)}` : ""}
      </Text>
    );
  const reelle =
    dedie && !j.dateReelle ? (
      modifiable && (
        <Button size="xs" variant="light" onClick={valider}>
          Valider les devis
        </Button>
      )
    ) : modifiable && !dedie ? (
      <ChampDate label={telephone ? "Réelle" : ""} value={j.dateReelle} onChange={(d) => ecrire(() => fixerJalon(p.id, j.code, { dateReelle: d }))} />
    ) : (
      <Text size="sm">{court(j.dateReelle)}</Text>
    );
  if (telephone)
    return (
      <Table.Tr>
        <Table.Td>
          <Stack gap={4}>
            {libelle}
            <SimpleGrid cols={2} spacing="xs">
              {prevue}
              {reelle}
            </SimpleGrid>
          </Stack>
        </Table.Td>
      </Table.Tr>
    );
  return (
    <Table.Tr>
      <Table.Td>{libelle}</Table.Td>
      <Table.Td w={170}>{prevue}</Table.Td>
      <Table.Td w={170}>{reelle}</Table.Td>
    </Table.Tr>
  );
}

/** Un lot et ses devis. */
function CarteLot({ p, l, modifierLot, ajouterDevis, ajouterDoc }: { p: Fiche; l: LotFiche; modifierLot: () => void; ajouterDevis: () => void; ajouterDoc: () => void }) {
  const modifiable = peutEcrire() && !p.devisValides;
  const devis = l.devis.filter((d) => !d.archive);
  const fichiersDevis = (id: string) => p.documents.filter((d) => d.devisId === id && !d.archive);
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Text fw={700} size="sm">
            Lot {l.numero} — {l.corpsEtat}
          </Text>
          <Text size="xs" c="dimmed">
            {l.entrepriseNom ?? "Entreprise à choisir"} · TVA {pourcent(l.tvaPb)} · commission {pourcent(l.commissionPb)}
          </Text>
        </div>
        <Group gap="xs" wrap="nowrap">
          <Stack gap={0} align="flex-end">
            <Text size="sm" fw={600} className="nombre">
              {l.montantTtc ? `${euros(l.montantTtc)} TTC` : "—"}
            </Text>
            {l.montantTtc ? (
              <Text size="xs" c="dimmed" className="nombre">
                commission {euros(commissionLot(l))} HT
              </Text>
            ) : null}
          </Stack>
          {peutEcrire() && (
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label="Actions du lot">
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {modifiable && (
                  <Menu.Item leftSection={<IconPlus size={14} />} onClick={ajouterDevis}>
                    Devis reçu
                  </Menu.Item>
                )}
                <Menu.Item leftSection={<IconFileText size={14} />} onClick={ajouterDoc}>
                  Document du lot
                </Menu.Item>
                {modifiable && (
                  <Menu.Item leftSection={<IconPencil size={14} />} onClick={modifierLot}>
                    Modifier le lot
                  </Menu.Item>
                )}
                {modifiable && (
                  <Menu.Item
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    onClick={() =>
                      modals.openConfirmModal({
                        title: `Retirer le lot ${l.numero} ?`,
                        children: <Text size="sm">Il reste consultable depuis le journal.</Text>,
                        labels: { confirm: "Retirer", cancel: "Annuler" },
                        onConfirm: () => ecrire(() => archiverLot(l.id)),
                      })
                    }
                  >
                    Retirer le lot
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>
      {devis.length > 0 && (
        <Table mt="xs" verticalSpacing={4} fz="sm">
          <Table.Tbody>
            {devis.map((d) => (
              <Table.Tr key={d.id}>
                <Table.Td>
                  {d.entrepriseNom}
                  <Text span c="dimmed" size="xs">
                    {" "}
                    {d.reference ? `${d.reference} · ` : ""}v{d.version} · {court(d.date)}
                  </Text>
                  {fichiersDevis(d.id).map((f) => (
                    <Anchor key={f.id} href={urlFichier(f.fichier)} target="_blank" size="xs" ml={6}>
                      PDF
                    </Anchor>
                  ))}
                </Table.Td>
                <Table.Td ta="right" className="nombre">
                  {euros(d.montantTtc)}
                </Table.Td>
                <Table.Td w={90}>
                  <Badge size="sm" variant="light" color={COULEUR_STATUT_DEVIS[d.statut]}>
                    {LIBELLES_STATUT_DEVIS[d.statut]}
                  </Badge>
                </Table.Td>
                {modifiable && (
                  <Table.Td w={96}>
                    <Group gap={2} wrap="nowrap" justify="flex-end">
                      {d.statut !== "retenu" && (
                        <Tooltip label="Retenir ce devis">
                          <ActionIcon variant="subtle" aria-label="Retenir" onClick={() => ecrire(() => retenirDevis(d.id))}>
                            <IconCheck size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {d.statut !== "refuse" && (
                        <Tooltip label="Refuser">
                          <ActionIcon variant="subtle" color="gray" aria-label="Refuser" onClick={() => ecrire(() => refuserDevis(d.id))}>
                            <IconX size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      <Tooltip label="Retirer (saisi par erreur)">
                        <ActionIcon variant="subtle" color="gray" aria-label="Retirer" onClick={() => ecrire(() => archiverDevis(d.id))}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}

/**
 * Échéancier : en base (facturer, régler) dès la mission validée ; avant, l'aperçu calculé. « Mettre à jour » aligne
 * l'échéancier sur les montants actuels (devis, taux, apport) après aperçu ; ce qui est facturé ou réglé ne bouge pas.
 */
function BlocEcheancier({ p, dateJalon }: { p: Fiche; dateJalon: (code: string) => string }) {
  const [apercu, setApercu] = useState<Awaited<ReturnType<typeof apercuEcheances>> | null>(null);
  const s = p.synthese;
  const ouvrirApercu = async () => {
    const a = await ecrire(() => apercuEcheances(p.id));
    if (a) setApercu(a);
  };
  const changements = apercu ? apercu.creees.length + apercu.modifiees.length + apercu.retirees.length : 0;
  return (
    <>
      {p.echeances.length > 0 ? (
        <TableEcheances echeances={p.echeances} />
      ) : s.echeancier.length === 0 ? (
        <Text size="sm" c="dimmed">
          {p.mission.avecTravaux ? "Saisissez l'estimation des travaux (Actions → Modifier) ou retenez des devis pour calculer les honoraires." : "Saisissez le forfait de la mission."}
        </Text>
      ) : (
        <>
          <Table verticalSpacing={4} fz="sm">
            <Table.Tbody>
              {s.echeancier.map((e) => (
                <Table.Tr key={e.code}>
                  <Table.Td>
                    {e.libelle}
                    <Text size="xs" c="dimmed">
                      {dateJalon(e.jalon) || "date à prévoir"}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" className="nombre">
                    {euros(e.ttc)}
                    <Text size="xs" c="dimmed">
                      {euros(e.ht)} HT
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Text size="xs" c="dimmed" mt="xs">
            Aperçu{s.estime ? " sur l'estimation des travaux" : ""} : l'échéancier entre en trésorerie à la validation de la mission.
          </Text>
        </>
      )}
      {peutEcrire() && (s.echeancier.length > 0 || p.echeances.length > 0) && (
        <Group justify="flex-end" mt="xs">
          <Button size="xs" variant="subtle" onClick={ouvrirApercu}>
            {p.echeances.length ? "Mettre à jour l'échéancier…" : "Planifier maintenant"}
          </Button>
        </Group>
      )}
      <Modal opened={!!apercu} onClose={() => setApercu(null)} title="Mettre à jour l'échéancier">
        {apercu && (
          <Stack gap="xs">
            {changements === 0 && <Text size="sm">L'échéancier est déjà à jour.</Text>}
            {apercu.creees.map((c, i) => (
              <Text key={`c${i}`} size="sm">
                + {c.libelle} : {euros(c.ttc)}
              </Text>
            ))}
            {apercu.modifiees.map((c, i) => (
              <Text key={`m${i}`} size="sm">
                ~ {c.libelle} : {euros(c.avantTtc)} → {euros(c.ttc)}
              </Text>
            ))}
            {apercu.retirees.map((c, i) => (
              <Text key={`r${i}`} size="sm" c="red">
                − {c.libelle} : {euros(c.ttc)}
              </Text>
            ))}
            <Text size="xs" c="dimmed">
              Les échéances facturées ou réglées ne changent pas ; le solde absorbe l'écart.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setApercu(null)}>
                Fermer
              </Button>
              {changements > 0 && (
                <Button onClick={async () => (await ecrire(() => planifierEcheances(p.id))) !== undefined && setApercu(null)}>
                  Appliquer
                </Button>
              )}
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}

// --- Page

export function FicheProjet() {
  const { id } = ficheProjetRoute.useParams();
  const { telephone } = useEcran();
  const { data: p, error } = useQuery({ queryKey: ["projet", id], queryFn: () => ficheProjet(id) });
  const { data: ref } = useQuery({ queryKey: ["referentiels"], queryFn: () => referentiels() });
  const [modifier, setModifier] = useState(false);
  const [echange, setEchange] = useState(false);
  const [clore, setClore] = useState(false);
  const [valider, setValider] = useState(false);
  const [lotEdite, setLotEdite] = useState<LotFiche | null | undefined>(undefined);
  const [lotDevis, setLotDevis] = useState<LotFiche | null>(null);
  const [lotDoc, setLotDoc] = useState<LotFiche | null>(null);

  if (error) return <Text p="xl">{error.message}</Text>;
  if (!p) return null;
  const s = p.synthese;
  const travaux = p.mission.avecTravaux;
  const typesProjet = TYPES_DOCUMENTS.filter((t) => t.cible === "projet" || t.cible === "lot").map((t) => t.code);
  const dateJalon = (code: string) => {
    const j = p.jalons.find((x) => x.code === code);
    return j?.dateReelle ? court(j.dateReelle) : j?.datePrevue ? `prévu ${court(j.datePrevue)}` : "";
  };

  return (
    <Stack p={telephone ? "md" : "xl"} gap="md" maw={1200}>
      <Group justify="space-between">
        <Anchor component={Link} to="/projets" size="sm">
          <Group gap={4}>
            <IconArrowLeft size={14} /> Projets
          </Group>
        </Anchor>
        {peutEcrire() && (
          <Group gap="xs">
            <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setEchange(true)}>
              Échange
            </Button>
            <Menu position="bottom-end">
              <Menu.Target>
                <Button size="xs" variant="default" rightSection={<IconDots size={14} />}>
                  Actions
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => setModifier(true)}>
                  Modifier le projet
                </Menu.Item>
                {p.issue === "en_cours" && !p.devisValides && (
                  <Menu.Item leftSection={<IconX size={14} />} onClick={() => setClore(true)}>
                    Perdu ou abandonné…
                  </Menu.Item>
                )}
                {p.issue !== "en_cours" && <Menu.Item onClick={() => ecrire(() => rouvrirProjet(p.id))}>Rouvrir le projet</Menu.Item>}
                <Menu.Item leftSection={<IconArchive size={14} />} onClick={() => ecrire(() => archiverProjet(p.id, !p.archive))}>
                  {p.archive ? "Ressortir des archives" : "Archiver"}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        )}
      </Group>

      <div>
        <Text size="xs" c="dimmed" fw={600} tt="uppercase">
          {p.reference} · {p.mission.libelle} · {p.origineLibelle}
        </Text>
        <Title order={2}>
          {p.client.nom} — {p.intitule}
        </Title>
        <Group gap="xs" mt={4}>
          {p.issue !== "en_cours" ? (
            <Badge color="red" variant="light">
              {LIBELLES_ISSUE[p.issue]} : {p.motifIssue}
            </Badge>
          ) : (
            <Badge variant="light">{p.jalon?.libelle ?? "Nouveau"}</Badge>
          )}
          {p.archive && <Badge color="gray">Archivé</Badge>}
          <Anchor renderRoot={(r) => <Link {...r} to="/contacts/$id" params={{ id: p.clientId }} />} size="sm">
            Fiche client
          </Anchor>
          {p.client.telephone && (
            <Anchor href={`tel:${p.client.telephone}`} size="sm">
              {p.client.telephone}
            </Anchor>
          )}
          {p.adresse && (
            <Text size="sm" c="dimmed">
              {p.adresse}
            </Text>
          )}
        </Group>
        {(p.trancheOrigine || p.tranchesSuivantes.length > 0) && (
          <Group gap="xs" mt={4}>
            {p.trancheOrigine && (
              <Anchor renderRoot={(r) => <Link {...r} to="/projets/$id" params={{ id: p.trancheOrigine!.id }} />} size="sm">
                ← Tranche précédente {p.trancheOrigine.reference}
              </Anchor>
            )}
            {p.tranchesSuivantes.map((t) => (
              <Anchor key={t.id} renderRoot={(r) => <Link {...r} to="/projets/$id" params={{ id: t.id }} />} size="sm">
                Tranche suivante {t.reference} →
              </Anchor>
            ))}
          </Group>
        )}
      </div>

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Card withBorder padding="md">
          <Text size="sm" c="dimmed">
            {travaux ? (s.estime ? "Travaux (estimation)" : "Travaux retenus") : "Mission"}
          </Text>
          <Text fz={24} fw={700} className="nombre">
            {travaux ? euros(s.travauxTtc) : euros(s.honorairesTtc)} <Text span size="sm">TTC</Text>
          </Text>
          <Text size="xs" c="dimmed">
            {travaux ? (s.estime ? "en attendant les devis retenus" : `${euros(s.travauxHt)} HT · ${p.lots.filter((l) => !l.archive && l.montantTtc).length} lot(s) avec devis retenu`) : p.mission.mode === "forfait" && !s.honorairesTtc ? "Forfait à saisir (Actions → Modifier)" : `${euros(s.honorairesHt)} HT`}
          </Text>
        </Card>
        <Card withBorder padding="md">
          <Text size="sm" c="dimmed">
            Honoraires {p.mission.mode === "pourcentage" && !p.forfaitTtc ? `(${pourcent(p.tauxPb ?? p.mission.tauxPb)} des travaux TTC)` : "(forfait)"}
          </Text>
          <Text fz={24} fw={700} className="nombre">
            {euros(s.honorairesTtc)} <Text span size="sm">TTC client</Text>
          </Text>
          <Text size="xs" c="dimmed">
            {euros(s.honorairesHt)} HT au taux de TVA des travaux
          </Text>
        </Card>
        <Card withBorder padding="md">
          <Text size="sm" c="dimmed">
            Commissions des entreprises
          </Text>
          <Text fz={24} fw={700} className="nombre">
            {euros(s.commissionsHt)} <Text span size="sm">HT</Text>
          </Text>
          <Text size="xs" c="dimmed">
            au démarrage des travaux{s.apportHt ? ` · apport à verser : ${euros(s.apportHt)} HT (${p.apporteur?.nom ?? ""})` : ""}
          </Text>
        </Card>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Title order={4} mb="xs">
            Jalons
          </Title>
          <Table verticalSpacing={4}>
            <Table.Thead hidden={telephone}>
              <Table.Tr>
                <Table.Th>Étape</Table.Th>
                <Table.Th>Prévue</Table.Th>
                <Table.Th>Réelle</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {p.jalons.map((j) => (
                <LigneJalon key={j.code} p={p} j={j} valider={() => setValider(true)} telephone={telephone} />
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Stack gap="md">
          <Card withBorder>
            <Title order={4} mb="xs">
              Échéancier
            </Title>
            <BlocEcheancier p={p} dateJalon={dateJalon} />
          </Card>

          <Card withBorder>
            <Group justify="space-between" mb="xs">
              <Title order={4}>Échanges</Title>
              {peutEcrire() && (
                <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEchange(true)}>
                  Échange
                </Button>
              )}
            </Group>
            {p.interactions.length === 0 && (
              <Text size="sm" c="dimmed">
                Aucun échange.
              </Text>
            )}
            <Stack gap="xs">
              {p.interactions.map((i) => (
                <div key={i.id}>
                  <Text size="xs" c="dimmed" component="div">
                    {court(i.date)}
                    {i.heure ? ` à ${i.heure}` : ""} · {LIBELLES_NATURE[i.nature]} · {i.contactNom}
                    {i.aFaireLe && !i.faite && (
                      <Badge size="xs" color="orange" variant="light" ml={6}>
                        relance {court(i.aFaireLe)}
                      </Badge>
                    )}
                  </Text>
                  <Text size="sm" fw={600}>
                    {i.objet}
                  </Text>
                  {i.texte && (
                    <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                      {i.texte}
                    </Text>
                  )}
                </div>
              ))}
            </Stack>
          </Card>
        </Stack>
      </SimpleGrid>

      {travaux && (
        <Card withBorder>
          <Group justify="space-between" mb="xs">
            <Title order={4}>Lots et devis</Title>
            {peutEcrire() && !p.devisValides && (
              <Group gap="xs">
                <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setLotEdite(null)}>
                  Lot
                </Button>
                {p.lots.some((l) => !l.archive) && (
                  <Button size="xs" onClick={() => setValider(true)}>
                    Valider les devis…
                  </Button>
                )}
              </Group>
            )}
          </Group>
          {p.devisValides && (
            <Text size="sm" c="dimmed" mb="xs">
              Devis validés : lots et devis sont figés (un changement sera un avenant, avec la trésorerie).
            </Text>
          )}
          {p.lots.filter((l) => !l.archive).length === 0 && (
            <Text size="sm" c="dimmed">
              Aucun lot. Ajoutez les corps d'état à consulter (maçonnerie, électricité…).
            </Text>
          )}
          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            {p.lots
              .filter((l) => !l.archive)
              .map((l) => (
                <CarteLot key={l.id} p={p} l={l} modifierLot={() => setLotEdite(l)} ajouterDevis={() => setLotDevis(l)} ajouterDoc={() => setLotDoc(l)} />
              ))}
          </SimpleGrid>
        </Card>
      )}

      {travaux && <SuiviChantier p={p} />}

      <ListeDocuments documents={p.documents.filter((d) => !d.devisId && !d.visiteId)} cible={{ projetId: p.id }} types={typesProjet} />

      {p.notes && (
        <Card withBorder>
          <Title order={4} mb="xs">
            Notes
          </Title>
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {p.notes}
          </Text>
        </Card>
      )}

      {estAdmin() && !telephone && <Historique id={id} />}

      <ModalModifier p={p} opened={modifier} onClose={() => setModifier(false)} />
      <ModalEchange opened={echange} onClose={() => setEchange(false)} projetId={p.id} contactId={p.clientId} />
      <ModalClore p={p} opened={clore} onClose={() => setClore(false)} />
      <ModalValider p={p} opened={valider} onClose={() => setValider(false)} />
      <ModalLot projetId={p.id} lot={lotEdite ?? null} opened={lotEdite !== undefined} onClose={() => setLotEdite(undefined)} commissionDefaut={ref?.commissionDefautPb ?? 1300} />
      <ModalDevis lot={lotDevis} opened={!!lotDevis} onClose={() => setLotDevis(null)} />
      <ModalDocument
        opened={!!lotDoc}
        onClose={() => setLotDoc(null)}
        cible={{ projetId: p.id, lotId: lotDoc?.id }}
        types={TYPES_DOCUMENTS.filter((t) => t.cible === "lot").map((t) => t.code)}
      />
    </Stack>
  );
}

