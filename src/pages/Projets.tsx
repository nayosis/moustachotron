import { Badge, Button, Card, Group, ScrollArea, SegmentedControl, Stack, Table, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import { IconPlus, IconSearch } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listeProjets } from "../data/projets";
import { dateLisible } from "../lib/dates";
import { useEcran } from "../lib/ecran";
import { COLONNES } from "../lib/jalons";
import { LIBELLES_ISSUE } from "../lib/libelles";
import { euros } from "../lib/montants";
import { useSaisie } from "../lib/saisie";
import { peutEcrire } from "../lib/session";
import { projetsRoute } from "../router";

type LigneProjet = Awaited<ReturnType<typeof listeProjets>>[number];
const court = (d: string) => dateLisible(d, { day: "numeric", month: "short" });

/** Carte d'un projet dans le pipeline : client, mission, montant, prochaine étape ou relance. */
function CarteProjet({ p, ouvrir }: { p: LigneProjet; ouvrir: () => void }) {
  return (
    <UnstyledButton onClick={ouvrir} style={{ display: "block" }}>
      <Card withBorder padding="sm" className="tuile">
        <Group justify="space-between" wrap="nowrap" gap={6}>
          <Text fw={600} size="sm" truncate>
            {p.clientNom}
          </Text>
          <Badge size="sm" variant="light">
            {p.missionCode}
          </Badge>
        </Group>
        <Text size="xs" c="dimmed" truncate>
          {p.reference} · {p.intitule}
        </Text>
        <Group justify="space-between" mt={6} gap={6} wrap="nowrap">
          <Text size="xs" style={{ fontVariantNumeric: "tabular-nums" }}>
            {p.travauxTtc ? `${euros(p.travauxTtc)} TTC` : p.honorairesTtc ? `${euros(p.honorairesTtc)} TTC` : "—"}
          </Text>
          {p.relance ? (
            <Badge size="xs" color="orange" variant="light">
              relance {court(p.relance)}
            </Badge>
          ) : p.prochain ? (
            <Badge size="xs" color={p.prochain.enRetard ? "red" : "gray"} variant="light">
              {p.prochain.libelle.split(" (")[0]} {court(p.prochain.date!)}
            </Badge>
          ) : null}
        </Group>
      </Card>
    </UnstyledButton>
  );
}

/** Projets : pipeline par étape (ordinateur, tablette) ou liste (téléphone, ou au choix). */
export function Projets() {
  const { telephone } = useEcran();
  const naviguer = useNavigate({ from: "/projets" });
  const { q, vue, issue } = projetsRoute.useSearch();
  const { nouveauProjet } = useSaisie();
  const { data: projets } = useQuery({ queryKey: ["projets", q, issue], queryFn: () => listeProjets({ recherche: q, issue: issue ?? "en_cours" }) });
  const enListe = telephone || vue === "liste" || !!issue;
  const ouvrir = (id: string) => naviguer({ to: "/projets/$id", params: { id } });

  return (
    <Stack p={telephone ? "md" : "xl"} gap="md" style={{ minHeight: 0 }}>
      <Group justify="space-between">
        <Title order={2}>Projets</Title>
        {peutEcrire() && (
          <Button leftSection={<IconPlus size={16} />} onClick={nouveauProjet}>
            Nouveau projet
          </Button>
        )}
      </Group>
      <Group gap="xs">
        <TextInput
          placeholder="Client, référence, intitulé, adresse"
          leftSection={<IconSearch size={16} />}
          defaultValue={q ?? ""}
          onChange={(e) => naviguer({ search: (s) => ({ ...s, q: e.currentTarget.value || undefined }), replace: true })}
          style={{ flex: 1, minWidth: 200 }}
        />
        <SegmentedControl
          value={issue ?? "en_cours"}
          onChange={(v) => naviguer({ search: (s) => ({ ...s, issue: v === "en_cours" ? undefined : (v as "perdu") }) })}
          data={Object.entries(LIBELLES_ISSUE).map(([value, label]) => ({ value, label }))}
        />
        {!telephone && !issue && (
          <SegmentedControl
            value={vue ?? "pipeline"}
            onChange={(v) => naviguer({ search: (s) => ({ ...s, vue: v === "pipeline" ? undefined : "liste" }) })}
            data={[
              { value: "pipeline", label: "Pipeline" },
              { value: "liste", label: "Liste" },
            ]}
          />
        )}
      </Group>

      {projets && projets.length === 0 && (
        <Text c="dimmed" size="sm">
          Aucun projet{q ? " pour cette recherche" : ""}. {peutEcrire() && !q && "Créez le premier avec « Nouveau projet » quand un prospect vous contacte."}
        </Text>
      )}

      {projets && projets.length > 0 && !enListe && (
        <ScrollArea type="auto" offsetScrollbars>
          <Group align="flex-start" wrap="nowrap" gap="sm">
            {COLONNES.filter((c) => c.code !== "clos").map((c) => {
              const dans = projets.filter((p) => (p.jalon?.colonne ?? "prospect") === c.code);
              return (
                <Stack key={c.code} gap="xs" w={240} style={{ flexShrink: 0 }} p="xs" bg="var(--mantine-color-default-hover)" className="colonne">
                  <Group justify="space-between">
                    <Text size="sm" fw={700}>
                      {c.libelle}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {dans.length}
                    </Text>
                  </Group>
                  {dans.map((p) => (
                    <CarteProjet key={p.id} p={p} ouvrir={() => ouvrir(p.id)} />
                  ))}
                </Stack>
              );
            })}
          </Group>
        </ScrollArea>
      )}

      {projets && projets.length > 0 && enListe && (
        telephone ? (
          <Stack gap="xs">
            {projets.map((p) => (
              <CarteProjet key={p.id} p={p} ouvrir={() => ouvrir(p.id)} />
            ))}
          </Stack>
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Réf.</Table.Th>
                <Table.Th>Client</Table.Th>
                <Table.Th>Projet</Table.Th>
                <Table.Th>Mission</Table.Th>
                <Table.Th>Étape</Table.Th>
                <Table.Th ta="right">Travaux TTC</Table.Th>
                <Table.Th ta="right">Honoraires HT</Table.Th>
                <Table.Th ta="right">Commissions HT</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {projets.map((p) => (
                <Table.Tr key={p.id} className="ligne-cliquable" onClick={() => ouvrir(p.id)}>
                  <Table.Td>{p.reference}</Table.Td>
                  <Table.Td fw={600}>{p.clientNom}</Table.Td>
                  <Table.Td>{p.intitule}</Table.Td>
                  <Table.Td>{p.missionCode}</Table.Td>
                  <Table.Td>{p.issue !== "en_cours" ? LIBELLES_ISSUE[p.issue] : (p.jalon?.libelle ?? "—")}</Table.Td>
                  <Table.Td ta="right" className="nombre">
                    {p.travauxTtc ? euros(p.travauxTtc) : ""}
                  </Table.Td>
                  <Table.Td ta="right" className="nombre">
                    {p.honorairesHt ? euros(p.honorairesHt) : ""}
                  </Table.Td>
                  <Table.Td ta="right" className="nombre">
                    {p.commissionsHt ? euros(p.commissionsHt) : ""}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )
      )}
    </Stack>
  );
}
