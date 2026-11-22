/*
 * Fiche projet : suivi de chantier — visites (rapports), réserves ouvertes, accès au chantier et urbanisme.
 */
import { useEffect, useState } from "react";
import { Anchor, Badge, Button, Card, Group, Modal, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from "@mantine/core";
import { IconFileTypePdf, IconPencil, IconPlus } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { creerVisite, listeVisites, majChantier, type Urbanisme } from "../data/visites";
import { dateLisible } from "../lib/dates";
import { ecrire } from "../lib/query";
import { peutEcrire } from "../lib/session";
import { ChampDate } from "./Champs";

const court = (d: string) => dateLisible(d, { day: "numeric", month: "short", year: "numeric" });

type ProjetChantier = {
  id: string;
  numeroDossier: string | null;
  accesConditions: string | null;
  accesStationnement: string | null;
  accesStockage: string | null;
  urbanisme: string | null;
};

/** Accès au chantier, n° de dossier et formalités d'urbanisme (en-tête et section III du rapport). */
function ModalChantier({ p, opened, onClose }: { p: ProjetChantier; opened: boolean; onClose: () => void }) {
  const [v, setV] = useState({ numeroDossier: "", accesConditions: "", accesStationnement: "", accesStockage: "" });
  const [u, setU] = useState<Urbanisme>({});
  useEffect(() => {
    if (!opened) return;
    setV({ numeroDossier: p.numeroDossier ?? "", accesConditions: p.accesConditions ?? "", accesStationnement: p.accesStationnement ?? "", accesStockage: p.accesStockage ?? "" });
    setU(p.urbanisme ? JSON.parse(p.urbanisme) : {});
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const date = (cle: keyof Urbanisme, label: string) => <ChampDate label={label} value={u[cle] ?? null} onChange={(d) => setU({ ...u, [cle]: d ?? undefined })} />;
  return (
    <Modal opened={opened} onClose={onClose} title="Chantier : accès et formalités" size="lg">
      <Stack>
        <TextInput label="N° de dossier" value={v.numeroDossier} onChange={(e) => setV({ ...v, numeroDossier: e.currentTarget.value })} />
        <Textarea label="Conditions d'accès (clés, codes, horaires)" description="Imprimées en rouge dans le rapport ; jamais dans une notification." autosize minRows={2} value={v.accesConditions} onChange={(e) => setV({ ...v, accesConditions: e.currentTarget.value })} />
        <Group grow>
          <TextInput label="Stationnement" value={v.accesStationnement} onChange={(e) => setV({ ...v, accesStationnement: e.currentTarget.value })} />
          <TextInput label="Stockage provisoire" value={v.accesStockage} onChange={(e) => setV({ ...v, accesStockage: e.currentTarget.value })} />
        </Group>
        <TextInput label="Planning" placeholder="Planning V2 du 13/01/26 transmis par mail le 13/01/2026" value={u.planning ?? ""} onChange={(e) => setU({ ...u, planning: e.currentTarget.value })} />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {date("depotDp", "Dépôt DP")}
          {date("acceptationDp", "Acceptation DP")}
          {date("affichage", "Affichage")}
          <TextInput label="Arrêté DP (n°)" value={u.arreteDp ?? ""} onChange={(e) => setU({ ...u, arreteDp: e.currentTarget.value })} />
          {date("docDeposee", "DOC déposée le")}
          {date("daactDeposee", "DAACT déposée le")}
        </SimpleGrid>
        <Textarea label="Prescriptions DP" autosize minRows={2} value={u.prescriptions ?? ""} onChange={(e) => setU({ ...u, prescriptions: e.currentTarget.value })} />
        <Text size="xs" c="dimmed">
          Début des travaux, réception et levée des réserves viennent des jalons du projet.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={async () => (await ecrire(() => majChantier(p.id, { ...v, urbanisme: u }).then(() => true))) && onClose()}>Enregistrer</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Bloc « Suivi de chantier » de la fiche projet. */
export function SuiviChantier({ p }: { p: ProjetChantier }) {
  const naviguer = useNavigate();
  const { data: visites } = useQuery({ queryKey: ["visites", p.id], queryFn: () => listeVisites(p.id) });
  const [chantier, setChantier] = useState(false);
  const nouvelle = async () => {
    const id = await ecrire(() => creerVisite(p.id));
    if (id) naviguer({ to: "/visites/$id", params: { id } });
  };
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <Title order={4}>Suivi de chantier</Title>
        {peutEcrire() && (
          <Group gap="xs">
            <Button size="xs" variant="default" leftSection={<IconPencil size={14} />} onClick={() => setChantier(true)}>
              Accès et formalités
            </Button>
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={nouvelle}>
              Nouvelle visite
            </Button>
          </Group>
        )}
      </Group>
      {p.accesConditions && (
        <Text size="sm" c="red" mb="xs">
          Accès : {p.accesConditions}
        </Text>
      )}
      <Stack gap={6}>
        {(visites ?? []).length === 0 && (
          <Text size="sm" c="dimmed">
            Aucune visite. « Nouvelle visite » prépare le rapport : intervenants, lots, avancement ; chaque visite reprend la précédente.
          </Text>
        )}
        {(visites ?? []).map((v) => (
          <Group key={v.id} justify="space-between" wrap="nowrap">
            <Anchor renderRoot={(r) => <Link {...r} to="/visites/$id" params={{ id: v.id }} />} size="sm">
              Visite n°{v.numero} — {v.dates.map(court).join(", ")}
            </Anchor>
            <Group gap="xs" wrap="nowrap">
              <Badge size="sm" variant="light" color={v.statut === "envoyee" ? "green" : "gray"}>
                {v.statut === "envoyee" ? `envoyé le ${court(v.envoyeeLe!)}` : "brouillon"}
              </Badge>
              <Anchor href={`/api/exports/visite/${v.id}`} target="_blank" aria-label="Rapport PDF">
                <IconFileTypePdf size={18} />
              </Anchor>
            </Group>
          </Group>
        ))}
      </Stack>
      <ModalChantier p={p} opened={chantier} onClose={() => setChantier(false)} />
    </Card>
  );
}
