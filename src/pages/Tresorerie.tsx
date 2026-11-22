import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ActionIcon, Alert, Anchor, Badge, Button, Card, FileButton, Group, Modal, ScrollArea, Select, SimpleGrid, Stack, Switch, Table, Tabs, Text, TextInput, Title, Tooltip,
} from "@mantine/core";
import { IconPaperclip, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  archiverChargeRecurrente, archiverMouvement, creerChargeRecurrente, creerMouvement, listeChargesRecurrentes, listeMouvements, majChargeRecurrente,
  majExercice, majHorizons, majMouvement, referentielTresorerie, syntheseExercice, vueTresorerie, type SaisieCharge, type SaisieMouvement,
} from "../data/tresorerie";
import type { ModeReglement } from "../data/echeances";
import { listeProjets } from "../data/projets";
import { ChampDate } from "../components/Champs";
import { envoyerTous, TYPES_ACCEPTES } from "../components/Documents";
import { LIBELLES_MODE, TableEcheances } from "../components/Echeances";
import { ImportReleve } from "../components/ImportReleve";
import { aujourdhui, dateLisible } from "../lib/dates";
import { useEcran } from "../lib/ecran";
import { urlFichier } from "../lib/fichiers";
import { euros, lireMontant } from "../lib/montants";
import { htDepuisTtc, pourcent } from "../lib/prix";
import { ecrire } from "../lib/query";
import { peutEcrire } from "../lib/session";
import { tresorerieRoute } from "../router";

type Vue = Awaited<ReturnType<typeof vueTresorerie>>;
type Categorie = Awaited<ReturnType<typeof referentielTresorerie>>["categories"][number];
const court = (d: string) => dateLisible(d, { day: "numeric", month: "short", year: "numeric" });
const moisLisible = (m: string) => {
  const t = new Date(`${m}-15T12:00:00Z`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const TVAS = [0, 550, 1000, 2000];
const saisieMontant = (c: number) => (c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2 });

/** Options de catégories groupées (Select Mantine). */
function optionsCategories(categories: Categorie[], sens?: Categorie["sens"][]) {
  const groupes = new Map<string, { value: string; label: string }[]>();
  for (const c of categories.filter((c) => !c.archive && (!sens || sens.includes(c.sens)))) groupes.set(c.groupe, [...(groupes.get(c.groupe) ?? []), { value: c.id, label: c.libelle }]);
  return [...groupes].map(([group, items]) => ({ group, items }));
}

// --- Prévisionnel

/** Courbe du solde projeté, jour par jour (SVG), avec le seuil zéro et les dates des horizons. */
function Courbe({ vue }: { vue: Vue }) {
  const points = vue.serie;
  if (points.length < 2) return null;
  const L = 760,
    H = 200,
    g = 64,
    d = 12,
    h = 14,
    b = 24;
  const valeurs = points.map((p) => p.solde / 100);
  const min = Math.min(0, ...valeurs),
    max = Math.max(1, ...valeurs);
  const pas = Math.pow(10, Math.floor(Math.log10(Math.max(1, max - min)))) * (max - min > 5 * Math.pow(10, Math.floor(Math.log10(Math.max(1, max - min)))) ? 1 : 0.5);
  const bas = Math.floor(min / pas) * pas,
    haut = Math.ceil(max / pas) * pas;
  const x = (i: number) => g + (i * (L - g - d)) / (points.length - 1);
  const y = (v: number) => h + ((haut - v) * (H - h - b)) / (haut - bas || 1);
  const chemin = valeurs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const graduations: number[] = [];
  for (let v = bas; v <= haut + 1e-6; v += pas) graduations.push(v);
  const indexDe = (date: string) => points.findIndex((p) => p.date === date);
  return (
    <svg viewBox={`0 0 ${L} ${H}`} width="100%" role="img" aria-label="Solde de trésorerie projeté" style={{ display: "block" }}>
      {graduations.map((v) => (
        <g key={v}>
          <line x1={g} x2={L - d} y1={y(v)} y2={y(v)} stroke="var(--mantine-color-default-border)" strokeDasharray={v === 0 ? undefined : "2 3"} />
          <text x={g - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--mantine-color-dimmed)">
            {Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("fr-FR")} k€` : `${v} €`}
          </text>
        </g>
      ))}
      <path d={`${chemin}L${x(points.length - 1)},${y(bas)}L${x(0)},${y(bas)}Z`} fill="var(--mantine-color-marque-6)" fillOpacity={0.1} />
      <path d={chemin} fill="none" stroke="var(--mantine-color-marque-6)" strokeWidth={2} />
      {vue.horizons.map((p) => {
        const i = indexDe(p.date);
        if (i < 0) return null;
        return (
          <g key={p.libelle}>
            <line x1={x(i)} x2={x(i)} y1={h} y2={H - b} stroke="var(--mantine-color-default-border)" />
            <circle cx={x(i)} cy={y(p.solde / 100)} r={4} fill="var(--mantine-color-body)" stroke="var(--mantine-color-marque-6)" strokeWidth={2} />
            <text x={Math.min(x(i) + 5, L - 70)} y={H - 8} fontSize="11" fill="var(--mantine-color-dimmed)">
              {p.libelle}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Previsionnel() {
  const { telephone } = useEcran();
  const [dateChoisie, setDateChoisie] = useState<string | null>(null);
  const [pondere, setPondere] = useState(false);
  const { data: v } = useQuery({ queryKey: ["tresorerie", dateChoisie, pondere], queryFn: () => vueTresorerie({ dateChoisie, pondere }) });
  if (!v) return null;
  return (
    <Stack gap="md">
      {!v.exercice && <Alert color="orange">Aucun exercice ne couvre aujourd'hui : créez-le dans l'onglet Réglages (trésorerie d'ouverture).</Alert>}
      <Group gap="md" align="flex-end">
        <ChampDate label="Horizon à une date" value={dateChoisie} onChange={setDateChoisie} minDate={aujourdhui()} />
        <Switch label="Pondérer les projets aux devis non validés" checked={pondere} onChange={(e) => setPondere(e.currentTarget.checked)} />
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: Math.min(4, v.horizons.length) }}>
        {v.horizons.map((p, i) => (
          <Card key={p.libelle} withBorder padding="md" bg={i === 0 ? "marque.7" : undefined}>
            <Text size="sm" c={i === 0 ? "marque.0" : "dimmed"}>
              {p.libelle} · {court(p.date)}
            </Text>
            <Text fz={26} fw={700} className="nombre" c={i === 0 ? "white" : p.solde < 0 ? "red" : undefined}>
              {euros(p.solde)}
            </Text>
            {pondere && p.certain !== p.solde && (
              <Text size="xs" c={i === 0 ? "marque.0" : "dimmed"}>
                certain : {euros(p.certain)}
              </Text>
            )}
            {i > 0 ? (
              <Stack gap={0} mt={4}>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Échéances
                  </Text>
                  <Text size="xs" className="nombre">
                    {euros(p.echeances)}
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Charges récurrentes
                  </Text>
                  <Text size="xs" className="nombre">
                    {euros(p.charges)}
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Redevances réseau
                  </Text>
                  <Text size="xs" className="nombre">
                    {euros(p.redevances)}
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    TVA à reverser
                  </Text>
                  <Text size="xs" className="nombre">
                    {euros(p.tva)}
                  </Text>
                </Group>
              </Stack>
            ) : (
              <Text size="xs" c="marque.0" mt={4}>
                Solde réel (ouverture de l'exercice + mouvements)
              </Text>
            )}
          </Card>
        ))}
      </SimpleGrid>
      {!telephone && (
        <Card withBorder>
          <Title order={4} mb="xs">
            Solde projeté
          </Title>
          <Courbe vue={v} />
        </Card>
      )}
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Group justify="space-between" mb="xs">
            <Title order={4}>À facturer sous 30 jours</Title>
            <Text size="xs" c="dimmed">
              reste à facturer {euros(v.resteAFacturerTtc)} · facturé non réglé {euros(v.factureNonRegleTtc)}
            </Text>
          </Group>
          {v.aFacturer.length === 0 ? (
            <Text size="sm" c="dimmed">
              Rien à facturer dans les 30 jours.
            </Text>
          ) : (
            <TableEcheances echeances={v.aFacturer} avecProjet compact />
          )}
          {v.retards.length > 0 && (
            <>
              <Title order={5} mt="md" mb={4} c="red">
                En retard (non comptées dans le prévu)
              </Title>
              <TableEcheances echeances={v.retards} avecProjet compact />
            </>
          )}
          {v.aDater.length > 0 && (
            <>
              <Title order={5} mt="md" mb={2}>
                À dater ({euros(v.aDater.reduce((s, e) => s + (e.sens === "entree" ? e.ttc : -e.ttc), 0))})
              </Title>
              <Text size="xs" c="dimmed" mb={4}>
                Pas encore dans le prévisionnel : datez le jalon du projet (démarrage, réception) ou l'échéance elle-même.
              </Text>
              <TableEcheances echeances={v.aDater} avecProjet compact />
            </>
          )}
        </Card>
        <Card withBorder>
          <Title order={4} mb="xs">
            Prochains mouvements prévus
          </Title>
          <Stack gap={4}>
            {v.prochains.length === 0 && (
              <Text size="sm" c="dimmed">
                Aucun flux prévu.
              </Text>
            )}
            {v.prochains.map((f, i) => (
              <Group key={i} justify="space-between" wrap="nowrap">
                <Text size="sm" truncate>
                  <Text span c="dimmed" size="xs">
                    {dateLisible(f.date, { day: "numeric", month: "short" })}
                  </Text>{" "}
                  {f.libelle}
                </Text>
                <Text size="sm" className="nombre" c={f.montant < 0 ? "red" : "green"} style={{ flexShrink: 0 }}>
                  {f.montant > 0 ? "+" : ""}
                  {euros(f.montant)}
                </Text>
              </Group>
            ))}
          </Stack>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}

// --- Prévu / réalisé

function PrevuRealise() {
  const { data: ref } = useQuery({ queryKey: ["referentielTresorerie"], queryFn: () => referentielTresorerie() });
  const [exerciceId, setExercice] = useState<string | null>(null);
  useEffect(() => {
    if (!exerciceId && ref?.exercices.length) {
      const aujd = aujourdhui();
      setExercice((ref.exercices.find((e) => e.debut <= aujd && e.fin >= aujd) ?? ref.exercices[0]).id);
    }
  }, [ref, exerciceId]);
  const { data: s } = useQuery({ queryKey: ["syntheseExercice", exerciceId], queryFn: () => syntheseExercice(exerciceId!), enabled: !!exerciceId });
  const groupes = useMemo(() => {
    const g = new Map<string, NonNullable<typeof s>["lignes"]>();
    for (const l of s?.lignes ?? []) g.set(l.groupe, [...(g.get(l.groupe) ?? []), l]);
    return [...g];
  }, [s]);
  if (!ref) return null;
  const cellule = (n: number) => (n ? euros(n) : "");
  return (
    <Stack gap="md">
      <Select label="Exercice" w={260} data={ref.exercices.map((e) => ({ value: e.id, label: e.libelle }))} value={exerciceId} onChange={setExercice} allowDeselect={false} />
      {s && (
        <ScrollArea type="auto">
          <Table withColumnBorders fz="xs" verticalSpacing={2} style={{ minWidth: 220 + s.mois.length * 210 }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>HT</Table.Th>
                {s.mois.map((m) => (
                  <Table.Th key={m} colSpan={3} ta="center" bg={m === s.moisCourant ? "var(--mantine-color-marque-light)" : undefined}>
                    {moisLisible(m)}
                  </Table.Th>
                ))}
              </Table.Tr>
              <Table.Tr>
                <Table.Th />
                {s.mois.map((m) => (
                  <Fragment key={m}>
                    <Table.Th ta="right">
                      Prévu
                    </Table.Th>
                    <Table.Th ta="right">
                      Réalisé
                    </Table.Th>
                    <Table.Th ta="right">
                      Écart
                    </Table.Th>
                  </Fragment>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {groupes.map(([groupe, lignes]) => (
                <Fragment key={groupe}>
                  <Table.Tr>
                    <Table.Td colSpan={1 + s.mois.length * 3} fw={700} bg="var(--mantine-color-default-hover)">
                      {groupe}
                    </Table.Td>
                  </Table.Tr>
                  {lignes.map((l) => (
                    <Table.Tr key={l.categorieId}>
                      <Table.Td>{l.libelle}</Table.Td>
                      {s.mois.map((m, i) => {
                        const ecart = l.realise[i] - l.prevu[i];
                        const mauvais = ecart < 0;
                        return (
                          <Fragment key={m}>
                            <Table.Td ta="right" className="nombre" c="dimmed">
                              {cellule(l.prevu[i])}
                            </Table.Td>
                            <Table.Td ta="right" className="nombre">
                              {cellule(l.realise[i])}
                            </Table.Td>
                            <Table.Td ta="right" className="nombre" c={ecart && m <= s.moisCourant ? (mauvais ? "red" : "green") : "dimmed"}>
                              {m <= s.moisCourant && (l.realise[i] || l.prevu[i]) ? cellule(ecart) : ""}
                            </Table.Td>
                          </Fragment>
                        );
                      })}
                    </Table.Tr>
                  ))}
                </Fragment>
              ))}
              <Table.Tr>
                <Table.Td fw={700}>Trésorerie fin de mois (TTC)</Table.Td>
                {s.finDeMois.map((f) => (
                  <Table.Td key={f.mois} colSpan={3} ta="right" fw={700} className="nombre" c={f.prevu ? "dimmed" : f.solde < 0 ? "red" : undefined}>
                    {euros(f.solde)}
                    {f.prevu ? " (prévu)" : ""}
                  </Table.Td>
                ))}
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
      <Text size="xs" c="dimmed">
        Prévu : échéances des projets et charges récurrentes ; réalisé : mouvements. Montants HT (dépenses en négatif). Un écart en rouge est
        défavorable.
      </Text>
    </Stack>
  );
}

// --- Mouvements

type MouvementLigne = Awaited<ReturnType<typeof listeMouvements>>[number];

function ModalMouvement({ opened, onClose, categories, initial }: { opened: boolean; onClose: () => void; categories: Categorie[]; initial: MouvementLigne | null }) {
  const { data: projets } = useQuery({ queryKey: ["projets", "options"], queryFn: () => listeProjets() });
  const [v, setV] = useState({ date: aujourdhui() as string | null, categorieId: null as string | null, objet: "", tiers: "", mode: "cb" as ModeReglement, montant: "", tvaPb: "2000", reference: "", projetId: null as string | null });
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    if (!opened) return;
    setFichiers([]);
    if (initial) {
      const ht = Math.abs(initial.ht),
        ttc = Math.abs(initial.ttc);
      const tva = ht && ttc !== ht ? Math.round(((ttc - ht) * 10_000) / ht) : 0;
      const proche = TVAS.reduce((a, b) => (Math.abs(b - tva) < Math.abs(a - tva) ? b : a), 0);
      const cat = categories.find((c) => c.id === initial.categorieId);
      const signe = cat && (cat.sens === "tva" || cat.sens === "financement");
      setV({ date: initial.date, categorieId: initial.categorieId, objet: initial.objet, tiers: initial.tiers ?? "", mode: initial.mode, montant: saisieMontant(signe ? initial.ttc : ttc), tvaPb: String(proche), reference: initial.reference ?? "", projetId: initial.projetId });
    } else setV({ date: aujourdhui(), categorieId: null, objet: "", tiers: "", mode: "cb", montant: "", tvaPb: "2000", reference: "", projetId: null });
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const cat = categories.find((c) => c.id === v.categorieId);
  const m = lireMontant(v.montant);
  const signe = cat && (cat.sens === "tva" || cat.sens === "financement");
  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const s: SaisieMouvement = { date: v.date!, categorieId: v.categorieId!, objet: v.objet, tiers: v.tiers, mode: v.mode, ttc: m!, tvaPb: signe ? 0 : Number(v.tvaPb), reference: v.reference, projetId: v.projetId };
      if (initial) {
        if ((await ecrire(() => majMouvement(initial.id, s).then(() => true))) === true) onClose();
        return;
      }
      const envoyes = await envoyerTous(fichiers);
      if (envoyes.length !== fichiers.length) return;
      if (await ecrire(() => creerMouvement(s, envoyes))) onClose();
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} title={initial ? "Corriger le mouvement" : "Nouvelle dépense ou recette"} size="lg">
      <Stack>
        <Group grow align="flex-start">
          <ChampDate label="Date de règlement" required value={v.date} onChange={(d) => setV({ ...v, date: d })} />
          <Select
            label="Catégorie"
            required
            searchable
            data={optionsCategories(categories)}
            value={v.categorieId}
            onChange={(c) => setV({ ...v, categorieId: c, tvaPb: String(categories.find((x) => x.id === c)?.tvaPb ?? 2000) })}
          />
        </Group>
        <TextInput label="Objet" required placeholder="Péage pont de Ré (visite chantier)" value={v.objet} onChange={(e) => setV({ ...v, objet: e.currentTarget.value })} />
        <Group grow>
          <TextInput label="Fournisseur / tiers" value={v.tiers} onChange={(e) => setV({ ...v, tiers: e.currentTarget.value })} />
          <Select label="Mode" data={Object.entries(LIBELLES_MODE).map(([value, label]) => ({ value, label }))} value={v.mode} onChange={(x) => x && setV({ ...v, mode: x as ModeReglement })} allowDeselect={false} />
        </Group>
        <Group grow align="flex-start">
          <TextInput
            label={signe ? "Montant (€, négatif si sortie)" : "Montant TTC (€)"}
            required
            value={v.montant}
            onChange={(e) => setV({ ...v, montant: e.currentTarget.value })}
            error={v.montant && m == null ? "Montant illisible" : undefined}
            description={m && !signe ? `${euros(htDepuisTtc(Math.abs(m), Number(v.tvaPb)))} HT` : cat ? (cat.sens === "depense" ? "Dépense : saisie en positif" : cat.sens === "recette" ? "Recette" : "") : ""}
          />
          {!signe && <Select label="TVA" data={TVAS.map((t) => ({ value: String(t), label: pourcent(t) }))} value={v.tvaPb} onChange={(x) => x && setV({ ...v, tvaPb: x })} allowDeselect={false} />}
        </Group>
        <Group grow>
          <TextInput label="Référence de la facture" value={v.reference} onChange={(e) => setV({ ...v, reference: e.currentTarget.value })} />
          <Select label="Projet (facultatif)" clearable searchable data={(projets ?? []).map((p) => ({ value: p.id, label: `${p.reference} · ${p.clientNom}` }))} value={v.projetId} onChange={(x) => setV({ ...v, projetId: x })} />
        </Group>
        {!initial && (
          <FileButton onChange={setFichiers} accept={TYPES_ACCEPTES} multiple>
            {(props) => (
              <Button {...props} variant="default" leftSection={<IconPaperclip size={16} />}>
                {fichiers.length ? fichiers.map((f) => f.name).join(", ") : "Joindre le justificatif (photo, PDF)"}
              </Button>
            )}
          </FileButton>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={envoi} disabled={!v.date || !v.categorieId || !v.objet.trim() || !m} onClick={enregistrer}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function Mouvements() {
  const { data: ref } = useQuery({ queryKey: ["referentielTresorerie"], queryFn: () => referentielTresorerie() });
  const [moisFiltre, setMois] = useState<string | null>(aujourdhui().slice(0, 7));
  const [categorieId, setCategorie] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [edition, setEdition] = useState<MouvementLigne | null | undefined>(undefined);
  const { data: lignes } = useQuery({ queryKey: ["mouvements", moisFiltre, categorieId, recherche], queryFn: () => listeMouvements({ mois: moisFiltre ?? undefined, categorieId: categorieId ?? undefined, recherche }) });
  const listeMois = useMemo(() => {
    const r: string[] = [];
    let m = aujourdhui().slice(0, 7);
    for (let i = 0; i < 36; i++) {
      r.push(m);
      const [a, mm] = m.split("-").map(Number);
      m = new Date(Date.UTC(a, mm - 2, 1)).toISOString().slice(0, 7);
    }
    return r;
  }, []);
  if (!ref) return null;
  const libelleCat = (id: string) => ref.categories.find((c) => c.id === id)?.libelle ?? id;
  const total = (lignes ?? []).reduce((s, l) => s + l.ttc, 0);
  return (
    <Stack gap="md">
      <Group gap="xs" align="flex-end">
        <Select label="Mois" clearable data={listeMois.map((m) => ({ value: m, label: moisLisible(m) }))} value={moisFiltre} onChange={setMois} w={140} />
        <Select label="Catégorie" clearable searchable data={optionsCategories(ref.categories)} value={categorieId} onChange={setCategorie} w={260} />
        <TextInput label="Recherche" value={recherche} onChange={(e) => setRecherche(e.currentTarget.value)} style={{ flex: 1, minWidth: 160 }} />
        {peutEcrire() && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEdition(null)}>
            Dépense ou recette
          </Button>
        )}
      </Group>
      <Table highlightOnHover fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Date</Table.Th>
            <Table.Th>Objet</Table.Th>
            <Table.Th>Catégorie</Table.Th>
            <Table.Th>Mode</Table.Th>
            <Table.Th ta="right">HT</Table.Th>
            <Table.Th ta="right">TTC</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(lignes ?? []).map((l) => (
            <Table.Tr key={l.id}>
              <Table.Td>{dateLisible(l.date, { day: "numeric", month: "short" })}</Table.Td>
              <Table.Td>
                {l.objet}
                <Text size="xs" c="dimmed">
                  {[l.tiers, l.reference].filter(Boolean).join(" · ")}
                  {l.justificatifs.map((j) => (
                    <Anchor key={j.fichier} href={urlFichier(j.fichier)} target="_blank" size="xs" ml={6}>
                      justificatif
                    </Anchor>
                  ))}
                </Text>
              </Table.Td>
              <Table.Td>{libelleCat(l.categorieId)}</Table.Td>
              <Table.Td>{LIBELLES_MODE[l.mode]}</Table.Td>
              <Table.Td ta="right" className="nombre">
                {euros(l.ht)}
              </Table.Td>
              <Table.Td ta="right" className="nombre" c={l.ttc < 0 ? "red" : "green"}>
                {euros(l.ttc)}
              </Table.Td>
              <Table.Td w={70}>
                {peutEcrire() && l.source !== "echeance" && (
                  <Group gap={2} wrap="nowrap">
                    <ActionIcon variant="subtle" color="gray" aria-label="Corriger" onClick={() => setEdition(l)}>
                      <IconPencil size={14} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" color="gray" aria-label="Retirer" onClick={() => ecrire(() => archiverMouvement(l.id))}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                )}
                {l.source === "echeance" && (
                  <Badge size="xs" variant="light">
                    échéance
                  </Badge>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="sm" ta="right">
        Solde des mouvements affichés : <b className="nombre">{euros(total)}</b>
      </Text>
      <ModalMouvement opened={edition !== undefined} onClose={() => setEdition(undefined)} categories={ref.categories} initial={edition ?? null} />
    </Stack>
  );
}

// --- Charges récurrentes

type ChargeLigne = Awaited<ReturnType<typeof listeChargesRecurrentes>>[number];

function ModalCharge({ opened, onClose, categories, initial }: { opened: boolean; onClose: () => void; categories: Categorie[]; initial: ChargeLigne | null }) {
  const vide = { libelle: "", tiers: "", categorieId: null as string | null, montant: "", tvaPb: "2000", periodicite: "mensuelle" as SaisieCharge["periodicite"], jour: "1", debut: aujourdhui() as string | null, fin: null as string | null, motCle: "" };
  const [v, setV] = useState(vide);
  useEffect(() => {
    if (!opened) return;
    setV(
      initial
        ? { libelle: initial.libelle, tiers: initial.tiers ?? "", categorieId: initial.categorieId, montant: saisieMontant(initial.montantTtc), tvaPb: String(initial.tvaPb), periodicite: initial.periodicite, jour: String(initial.jour), debut: initial.debut, fin: initial.fin, motCle: initial.motCle ?? "" }
        : vide,
    );
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = lireMontant(v.montant);
  const enregistrer = async () => {
    const s: SaisieCharge = { libelle: v.libelle, tiers: v.tiers, categorieId: v.categorieId!, montantTtc: m!, tvaPb: Number(v.tvaPb), periodicite: v.periodicite, jour: Number(v.jour), debut: v.debut!, fin: v.fin, motCle: v.motCle };
    const r = initial ? await ecrire(() => majChargeRecurrente(initial.id, s).then(() => true)) : await ecrire(() => creerChargeRecurrente(s));
    if (r) onClose();
  };
  return (
    <Modal opened={opened} onClose={onClose} title={initial ? "Charge récurrente" : "Nouvelle charge récurrente"} size="lg">
      <Stack>
        <Group grow>
          <TextInput label="Libellé" required placeholder="Loyer du local" value={v.libelle} onChange={(e) => setV({ ...v, libelle: e.currentTarget.value })} data-autofocus />
          <Select
            label="Catégorie"
            required
            searchable
            data={optionsCategories(categories, ["depense"])}
            value={v.categorieId}
            onChange={(c) => setV({ ...v, categorieId: c, tvaPb: String(categories.find((x) => x.id === c)?.tvaPb ?? 2000) })}
          />
        </Group>
        <Group grow align="flex-start">
          <TextInput label="Montant TTC (€)" required value={v.montant} onChange={(e) => setV({ ...v, montant: e.currentTarget.value })} error={v.montant && !m ? "Montant illisible" : undefined} />
          <Select label="TVA" data={TVAS.map((t) => ({ value: String(t), label: pourcent(t) }))} value={v.tvaPb} onChange={(x) => x && setV({ ...v, tvaPb: x })} allowDeselect={false} />
        </Group>
        <Group grow>
          <Select
            label="Périodicité"
            data={[
              { value: "mensuelle", label: "Tous les mois" },
              { value: "trimestrielle", label: "Tous les trimestres" },
              { value: "annuelle", label: "Tous les ans" },
            ]}
            value={v.periodicite}
            onChange={(x) => x && setV({ ...v, periodicite: x as SaisieCharge["periodicite"] })}
            allowDeselect={false}
          />
          <TextInput label="Jour du mois" value={v.jour} onChange={(e) => setV({ ...v, jour: e.currentTarget.value })} />
        </Group>
        <Group grow>
          <ChampDate label="À partir du" required value={v.debut} onChange={(d) => setV({ ...v, debut: d })} />
          <ChampDate label="Jusqu'au (facultatif)" value={v.fin} onChange={(d) => setV({ ...v, fin: d })} />
        </Group>
        <Group grow>
          <TextInput label="Fournisseur" value={v.tiers} onChange={(e) => setV({ ...v, tiers: e.currentTarget.value })} />
          <TextInput label="Mot-clé du relevé bancaire" description="Pour la reconnaître à l'import (« URSSAF »)" value={v.motCle} onChange={(e) => setV({ ...v, motCle: e.currentTarget.value })} />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!v.libelle.trim() || !v.categorieId || !m || !v.debut} onClick={enregistrer}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function Charges() {
  const { data: ref } = useQuery({ queryKey: ["referentielTresorerie"], queryFn: () => referentielTresorerie() });
  const { data: charges } = useQuery({ queryKey: ["charges"], queryFn: () => listeChargesRecurrentes() });
  const [edition, setEdition] = useState<ChargeLigne | null | undefined>(undefined);
  if (!ref) return null;
  const mensuel = (charges ?? []).reduce((s, c) => s + (c.periodicite === "mensuelle" ? c.montantTtc : c.periodicite === "trimestrielle" ? c.montantTtc / 3 : c.montantTtc / 12), 0);
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Environ <b className="nombre">{euros(Math.round(mensuel))}</b> TTC par mois.
        </Text>
        {peutEcrire() && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEdition(null)}>
            Charge récurrente
          </Button>
        )}
      </Group>
      <Table highlightOnHover fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Libellé</Table.Th>
            <Table.Th>Catégorie</Table.Th>
            <Table.Th>Quand</Table.Th>
            <Table.Th>Période</Table.Th>
            <Table.Th ta="right">TTC</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(charges ?? []).map((c) => (
            <Table.Tr key={c.id}>
              <Table.Td>
                {c.libelle}
                {c.tiers && (
                  <Text size="xs" c="dimmed">
                    {c.tiers}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>{ref.categories.find((x) => x.id === c.categorieId)?.libelle}</Table.Td>
              <Table.Td>
                le {c.jour}, {c.periodicite === "mensuelle" ? "chaque mois" : c.periodicite === "trimestrielle" ? "chaque trimestre" : "chaque année"}
              </Table.Td>
              <Table.Td>
                depuis le {court(c.debut)}
                {c.fin ? ` jusqu'au ${court(c.fin)}` : ""}
              </Table.Td>
              <Table.Td ta="right" className="nombre">
                {euros(c.montantTtc)}
              </Table.Td>
              <Table.Td w={70}>
                {peutEcrire() && (
                  <Group gap={2} wrap="nowrap">
                    <ActionIcon variant="subtle" color="gray" aria-label="Modifier" onClick={() => setEdition(c)}>
                      <IconPencil size={14} />
                    </ActionIcon>
                    <Tooltip label="Retirer">
                      <ActionIcon variant="subtle" color="gray" aria-label="Retirer" onClick={() => ecrire(() => archiverChargeRecurrente(c.id))}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {(charges ?? []).length === 0 && (
        <Text size="sm" c="dimmed">
          Ajoutez le loyer, la LOA, le salaire, le prêt, les redevances fixes du réseau… : elles alimentent le prévisionnel.
        </Text>
      )}
      <ModalCharge opened={edition !== undefined} onClose={() => setEdition(undefined)} categories={ref.categories} initial={edition ?? null} />
    </Stack>
  );
}

// --- Réglages

function Reglages() {
  const { data: ref } = useQuery({ queryKey: ["referentielTresorerie"], queryFn: () => referentielTresorerie() });
  const [ouvertures, setOuvertures] = useState<Record<string, string>>({});
  const [objectifs, setObjectifs] = useState<Record<string, string>>({});
  const [horizons, setHorizons] = useState("");
  useEffect(() => {
    if (!ref) return;
    setOuvertures(Object.fromEntries(ref.exercices.map((e) => [e.id, saisieMontant(e.tresorerieOuverture)])));
    setObjectifs(Object.fromEntries(ref.exercices.map((e) => [e.id, e.objectifCaHt == null ? "" : saisieMontant(e.objectifCaHt)])));
    setHorizons(ref.horizons.join(", "));
  }, [ref]);
  if (!ref) return null;
  const listeHorizons = horizons.split(/[,;\s]+/).filter(Boolean).map(Number);
  return (
    <Stack gap="md" maw={760}>
      <Card withBorder>
        <Title order={4} mb="xs">
          Exercices
        </Title>
        <Table fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Exercice</Table.Th>
              <Table.Th>Trésorerie d'ouverture (€)</Table.Th>
              <Table.Th>Objectif de CA HT (€)</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {ref.exercices.map((e) => {
              const o = lireMontant(ouvertures[e.id] ?? "");
              const ob = (objectifs[e.id] ?? "").trim() ? lireMontant(objectifs[e.id]) : null;
              return (
                <Table.Tr key={e.id}>
                  <Table.Td>
                    {e.libelle}
                    <Text size="xs" c="dimmed">
                      {court(e.debut)} → {court(e.fin)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <TextInput size="xs" value={ouvertures[e.id] ?? ""} onChange={(x) => setOuvertures({ ...ouvertures, [e.id]: x.currentTarget.value })} />
                  </Table.Td>
                  <Table.Td>
                    <TextInput size="xs" value={objectifs[e.id] ?? ""} onChange={(x) => setObjectifs({ ...objectifs, [e.id]: x.currentTarget.value })} />
                  </Table.Td>
                  <Table.Td>
                    {peutEcrire() && (
                      <Button size="xs" variant="light" disabled={o == null} onClick={() => ecrire(() => majExercice(e.id, { tresorerieOuverture: o!, objectifCaHt: ob }))}>
                        Enregistrer
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Card>
      <Card withBorder>
        <Title order={4} mb="xs">
          Horizons du prévisionnel
        </Title>
        <Group align="flex-end">
          <TextInput label="En jours, séparés par des virgules" description="0 = aujourd'hui ; 30 = +1 mois ; 90 = +3 mois" value={horizons} onChange={(e) => setHorizons(e.currentTarget.value)} w={320} />
          {peutEcrire() && (
            <Button variant="light" disabled={!listeHorizons.length || listeHorizons.some((n) => !Number.isInteger(n))} onClick={() => ecrire(() => majHorizons(listeHorizons))}>
              Enregistrer
            </Button>
          )}
        </Group>
      </Card>
    </Stack>
  );
}

/** Onglet « Relevé bancaire ». */
function PanneauReleve() {
  const { data: ref } = useQuery({ queryKey: ["referentielTresorerie"], queryFn: () => referentielTresorerie() });
  return ref ? <ImportReleve categories={ref.categories} /> : null;
}

// --- Page

/** Trésorerie : prévisionnel (téléphone et ordinateur) ; prévu / réalisé, mouvements, charges, réglages (ordinateur). */
export function Tresorerie() {
  const { telephone } = useEcran();
  const { onglet } = tresorerieRoute.useSearch();
  const naviguer = useNavigate({ from: "/tresorerie" });
  const actif = telephone ? "previsionnel" : (onglet ?? "previsionnel");
  return (
    <Stack p={telephone ? "md" : "xl"} gap="md" maw={1400}>
      <Group justify="space-between">
        <Title order={2}>Trésorerie</Title>
        <Anchor renderRoot={(r) => <Link {...r} to="/projets" />} size="sm">
          Projets
        </Anchor>
      </Group>
      {telephone ? (
        <Previsionnel />
      ) : (
        <Tabs value={actif} onChange={(o) => naviguer({ search: { onglet: o === "previsionnel" ? undefined : (o as "mouvements") } })} keepMounted={false}>
          <Tabs.List mb="md">
            <Tabs.Tab value="previsionnel">Prévisionnel</Tabs.Tab>
            <Tabs.Tab value="synthese">Prévu / réalisé</Tabs.Tab>
            <Tabs.Tab value="mouvements">Mouvements</Tabs.Tab>
            <Tabs.Tab value="releve">Relevé bancaire</Tabs.Tab>
            <Tabs.Tab value="charges">Charges récurrentes</Tabs.Tab>
            <Tabs.Tab value="reglages">Réglages</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="previsionnel">
            <Previsionnel />
          </Tabs.Panel>
          <Tabs.Panel value="synthese">
            <PrevuRealise />
          </Tabs.Panel>
          <Tabs.Panel value="mouvements">
            <Mouvements />
          </Tabs.Panel>
          <Tabs.Panel value="releve">
            <PanneauReleve />
          </Tabs.Panel>
          <Tabs.Panel value="charges">
            <Charges />
          </Tabs.Panel>
          <Tabs.Panel value="reglages">
            <Reglages />
          </Tabs.Panel>
        </Tabs>
      )}
    </Stack>
  );
}
