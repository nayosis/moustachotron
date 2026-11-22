import { useEffect, useState } from "react";
import {
  ActionIcon, Alert, Anchor, Badge, Button, Card, Checkbox, FileButton, Group, Image, SegmentedControl, SimpleGrid, Slider, Stack, Text, Textarea, TextInput, Title, Tooltip,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconArrowLeft, IconCamera, IconCheck, IconFileTypePdf, IconPlus, IconSend, IconTrash, IconX } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { retirerDocument } from "../data/documents";
import { ajouterPhotosVisite, creerReserve, envoyerVisite, ficheVisite, leverReserve, majPointLot, majPresence, majVisite, type EtatPresence } from "../data/visites";
import { ChampDate } from "../components/Champs";
import { envoyerTous } from "../components/Documents";
import { aujourdhui, dateLisible } from "../lib/dates";
import { useEcran } from "../lib/ecran";
import { urlFichier } from "../lib/fichiers";
import { ecrire } from "../lib/query";
import { peutEcrire } from "../lib/session";
import { visiteRoute } from "../router";

type Fiche = Awaited<ReturnType<typeof ficheVisite>>;
type Point = Fiche["points"][number];
const court = (d: string) => dateLisible(d, { day: "numeric", month: "short", year: "numeric" });
const ETATS: { value: EtatPresence; label: string }[] = [
  { value: "present", label: "P" },
  { value: "absent", label: "A" },
  { value: "retard", label: "R" },
  { value: "excuse", label: "E" },
];

/** Champ texte enregistré quand on le quitte (pas à chaque frappe). */
function TexteLibre({ label, valeur, description, enregistrer, lignes = 2, lecture }: { label: string; valeur: string | null; description?: string; enregistrer: (v: string) => Promise<unknown>; lignes?: number; lecture: boolean }) {
  const [v, setV] = useState(valeur ?? "");
  useEffect(() => setV(valeur ?? ""), [valeur]);
  return (
    <Textarea
      label={label}
      description={description}
      autosize
      minRows={lignes}
      value={v}
      readOnly={lecture}
      onChange={(e) => setV(e.currentTarget.value)}
      onBlur={() => v !== (valeur ?? "") && enregistrer(v)}
    />
  );
}

/** Bloc d'un lot : avancement, suivi, constats, observations, photos, réserves. */
function BlocLot({ f, pt, lecture }: { f: Fiche; pt: Point; lecture: boolean }) {
  const [avancement, setAvancement] = useState(pt.avancement ?? 0);
  const [reserve, setReserve] = useState("");
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => setAvancement(pt.avancement ?? 0), [pt.avancement]);
  const photos = f.photos.filter((p) => p.lotId === pt.lotId);
  const reserves = f.reserves.filter((r) => r.lotId === pt.lotId);
  const joindre = async (fichiers: File[]) => {
    setEnvoi(true);
    try {
      const envoyes = await envoyerTous(fichiers);
      if (envoyes.length) await ecrire(() => ajouterPhotosVisite(f.id, pt.lotId, envoyes));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Card withBorder>
      <Group justify="space-between" wrap="nowrap" mb="xs">
        <div style={{ minWidth: 0 }}>
          <Text fw={700}>
            Lot {String(pt.numero).padStart(2, "0")} : {pt.corpsEtat}
          </Text>
          <Text size="sm" c="dimmed">
            {pt.entrepriseNom ?? "Entreprise à choisir"}
          </Text>
        </div>
        <Badge size="lg" variant="light">
          {avancement} %
        </Badge>
      </Group>
      <Stack gap="sm">
        <Slider
          value={avancement}
          onChange={setAvancement}
          onChangeEnd={(x) => ecrire(() => majPointLot(pt.id, { avancement: x }))}
          step={5}
          disabled={lecture}
          marks={[{ value: 0 }, { value: 50 }, { value: 100 }]}
          label={(x) => `${x} %`}
          mb="sm"
        />
        <TexteLibre label="Suivi (devis, acomptes…)" valeur={pt.suivi} lecture={lecture} enregistrer={(v) => ecrire(() => majPointLot(pt.id, { suivi: v }))} />
        <TexteLibre label="Constats d'avancement" valeur={pt.constats} lecture={lecture} enregistrer={(v) => ecrire(() => majPointLot(pt.id, { constats: v }))} />
        <TexteLibre
          label="Observations de cette visite"
          description="Une ligne qui commence par « ! » est importante : en rouge dans le rapport."
          valeur={pt.observations}
          lignes={3}
          lecture={lecture}
          enregistrer={(v) => ecrire(() => majPointLot(pt.id, { observations: v }))}
        />
        {photos.length > 0 && (
          <SimpleGrid cols={{ base: 3, sm: 4 }} spacing={6}>
            {photos.map((p) => (
              <div key={p.id} style={{ position: "relative" }}>
                <Anchor href={urlFichier(p.fichier)} target="_blank">
                  <Image src={urlFichier(p.fichier)} alt={p.nom} radius="sm" h={90} fit="cover" />
                </Anchor>
                {!lecture && (
                  <ActionIcon size="sm" variant="white" color="red" style={{ position: "absolute", top: 4, right: 4 }} aria-label="Retirer la photo" onClick={() => ecrire(() => retirerDocument(p.id))}>
                    <IconTrash size={12} />
                  </ActionIcon>
                )}
              </div>
            ))}
          </SimpleGrid>
        )}
        {!lecture && (
          <Group gap="xs">
            <FileButton onChange={(x) => x && joindre([x])} accept="image/jpeg,image/png" capture="environment">
              {(props) => (
                <Button {...props} variant="light" size="xs" leftSection={<IconCamera size={14} />} loading={envoi}>
                  Photo
                </Button>
              )}
            </FileButton>
            <FileButton onChange={joindre} accept="image/jpeg,image/png" multiple>
              {(props) => (
                <Button {...props} variant="default" size="xs" loading={envoi}>
                  Depuis la galerie
                </Button>
              )}
            </FileButton>
          </Group>
        )}
        <div>
          <Text size="sm" fw={600}>
            Réserves
          </Text>
          {reserves.length === 0 && (
            <Text size="xs" c="dimmed">
              Aucune.
            </Text>
          )}
          {reserves.map((r) => (
            <Group key={r.id} justify="space-between" wrap="nowrap" gap="xs">
              <Text size="sm" c={r.leveeLe ? "dimmed" : "red"} td={r.leveeLe ? "line-through" : undefined}>
                {r.description}{" "}
                <Text span size="xs" c="dimmed">
                  ({court(r.constateeLe)}
                  {r.leveeLe ? `, levée le ${court(r.leveeLe)}` : ""})
                </Text>
              </Text>
              {peutEcrire() && (
                <Tooltip label={r.leveeLe ? "Rouvrir" : "Levée aujourd'hui"}>
                  <ActionIcon variant="subtle" color={r.leveeLe ? "gray" : "green"} aria-label={r.leveeLe ? "Rouvrir la réserve" : "Lever la réserve"} onClick={() => ecrire(() => leverReserve(r.id, r.leveeLe ? null : aujourdhui()))}>
                    {r.leveeLe ? <IconX size={14} /> : <IconCheck size={14} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          ))}
          {peutEcrire() && (
            <Group gap="xs" mt={4} wrap="nowrap">
              <TextInput size="xs" placeholder="Nouvelle réserve" value={reserve} onChange={(e) => setReserve(e.currentTarget.value)} style={{ flex: 1 }} />
              <ActionIcon
                variant="light"
                aria-label="Ajouter la réserve"
                disabled={!reserve.trim()}
                onClick={async () => (await ecrire(() => creerReserve(f.projetId, { lotId: pt.lotId, description: reserve, visiteId: f.id }))) && setReserve("")}
              >
                <IconPlus size={14} />
              </ActionIcon>
            </Group>
          )}
        </div>
      </Stack>
    </Card>
  );
}

/** Saisie d'une visite de chantier (téléphone d'abord) et son rapport PDF. */
export function Visite() {
  const { id } = visiteRoute.useParams();
  const { telephone } = useEcran();
  const { data: f, error } = useQuery({ queryKey: ["visite", id], queryFn: () => ficheVisite(id) });
  const [nouvelleDate, setNouvelleDate] = useState<string | null>(null);
  if (error) return <Text p="xl">{error.message}</Text>;
  if (!f) return null;
  const lecture = !peutEcrire() || f.statut === "envoyee";
  const envoyer = () =>
    modals.openConfirmModal({
      title: `Marquer le rapport n°${f.numero} comme envoyé ?`,
      children: <Text size="sm">Il ne sera plus modifiable. Envoyez le PDF au client et aux entreprises depuis votre messagerie.</Text>,
      labels: { confirm: "Envoyé", cancel: "Annuler" },
      onConfirm: () => ecrire(() => envoyerVisite(f.id)),
    });

  return (
    <Stack p={telephone ? "sm" : "xl"} gap="md" maw={900}>
      <Group justify="space-between">
        <Anchor renderRoot={(r) => <Link {...r} to="/projets/$id" params={{ id: f.projetId }} />} size="sm">
          <Group gap={4}>
            <IconArrowLeft size={14} /> {f.projet.clientNom}
          </Group>
        </Anchor>
        <Group gap="xs">
          <Button component="a" href={`/api/exports/visite/${f.id}`} target="_blank" size="xs" variant="default" leftSection={<IconFileTypePdf size={14} />}>
            PDF
          </Button>
          {!lecture && (
            <Button size="xs" leftSection={<IconSend size={14} />} onClick={envoyer}>
              Envoyé
            </Button>
          )}
        </Group>
      </Group>
      <div>
        <Title order={2}>Visite n°{f.numero}</Title>
        <Text c="dimmed" size="sm">
          {f.projet.intitule}
          {f.statut === "envoyee" && ` · rapport envoyé le ${court(f.envoyeeLe!)}`}
        </Text>
      </div>
      {f.statut === "envoyee" && <Alert color="gray">Rapport envoyé : il n'est plus modifiable. Pour la suite du chantier, créez la visite suivante depuis le projet.</Alert>}

      <Card withBorder>
        <Text fw={600} size="sm" mb={4}>
          Dates de la visite
        </Text>
        <Group gap={6}>
          {f.dates.map((d) => (
            <Badge
              key={d}
              variant="light"
              size="lg"
              rightSection={
                !lecture && f.dates.length > 1 ? (
                  <IconX size={12} style={{ cursor: "pointer" }} onClick={() => ecrire(() => majVisite(f.id, { dates: f.dates.filter((x) => x !== d) }))} />
                ) : undefined
              }
            >
              {court(d)}
            </Badge>
          ))}
          {!lecture && (
            <Group gap={4} wrap="nowrap">
              <ChampDate label="" value={nouvelleDate} onChange={setNouvelleDate} />
              <ActionIcon variant="light" disabled={!nouvelleDate} aria-label="Ajouter la date" onClick={async () => (await ecrire(() => majVisite(f.id, { dates: [...f.dates, nouvelleDate!] }).then(() => true))) && setNouvelleDate(null)}>
                <IconPlus size={14} />
              </ActionIcon>
            </Group>
          )}
        </Group>
      </Card>

      <Card withBorder>
        <Title order={4} mb="xs">
          Qui est là ?
        </Title>
        <Stack gap="xs">
          {f.presences.map((p) => (
            <Group key={p.id} justify="space-between" wrap={telephone ? "wrap" : "nowrap"} gap="xs">
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" fw={600} truncate>
                  {p.role}
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  {p.representant ?? "—"}
                </Text>
              </div>
              <Group gap="xs" wrap="nowrap">
                <SegmentedControl
                  size="xs"
                  disabled={lecture}
                  value={p.etat ?? ""}
                  onChange={(x) => ecrire(() => majPresence(p.id, { etat: (x || null) as EtatPresence | null }))}
                  data={[{ value: "", label: "–" }, ...ETATS]}
                />
                <Checkbox size="xs" label="Conv." checked={p.convoque} disabled={lecture} onChange={(e) => ecrire(() => majPresence(p.id, { convoque: e.currentTarget.checked }))} />
                <Checkbox size="xs" label="Diff." checked={p.diffusion} disabled={lecture} onChange={(e) => ecrire(() => majPresence(p.id, { diffusion: e.currentTarget.checked }))} />
              </Group>
            </Group>
          ))}
        </Stack>
      </Card>

      {f.points.length === 0 && (
        <Text size="sm" c="dimmed">
          Ce projet n'a pas de lot : ajoutez-les sur la fiche projet pour suivre l'avancement par lot.
        </Text>
      )}
      {f.points.map((pt) => (
        <BlocLot key={pt.id} f={f} pt={pt} lecture={lecture} />
      ))}

      <Card withBorder>
        <Stack gap="sm">
          <TexteLibre label="Principaux sujets de la réunion à venir" valeur={f.sujetsAVenir} lecture={lecture} enregistrer={(v) => ecrire(() => majVisite(f.id, { sujetsAVenir: v }))} />
          <TexteLibre label="Note générale" valeur={f.noteGenerale} lecture={lecture} enregistrer={(v) => ecrire(() => majVisite(f.id, { noteGenerale: v }))} />
        </Stack>
      </Card>
    </Stack>
  );
}
