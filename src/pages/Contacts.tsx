import { useState } from "react";
import { Anchor, Badge, Button, Card, Group, SegmentedControl, Stack, Table, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import { IconPlus, IconSearch } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listeContacts, type TypeContact } from "../data/contacts";
import { ModalContact } from "../components/Formulaires";
import { useEcran } from "../lib/ecran";
import { LIBELLES_TYPE_CONTACT } from "../lib/libelles";
import { peutEcrire } from "../lib/session";
import { contactsRoute } from "../router";

/** Contacts : clients et prospects, entreprises, apporteurs, partenaires. */
export function Contacts() {
  const { telephone } = useEcran();
  const naviguer = useNavigate({ from: "/contacts" });
  const { q, type } = contactsRoute.useSearch();
  const [creation, setCreation] = useState(false);
  const { data: contacts } = useQuery({ queryKey: ["contacts", q, type], queryFn: () => listeContacts({ recherche: q, type }) });
  const ouvrir = (id: string) => naviguer({ to: "/contacts/$id", params: { id } });

  return (
    <Stack p={telephone ? "md" : "xl"} gap="md" maw={1200}>
      <Group justify="space-between">
        <Title order={2}>Contacts</Title>
        {peutEcrire() && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreation(true)}>
            Nouveau contact
          </Button>
        )}
      </Group>
      <Group gap="xs">
        <TextInput
          placeholder="Nom, interlocuteur, corps d'état, e-mail"
          leftSection={<IconSearch size={16} />}
          defaultValue={q ?? ""}
          onChange={(e) => naviguer({ search: (s) => ({ ...s, q: e.currentTarget.value || undefined }), replace: true })}
          style={{ flex: 1, minWidth: 200 }}
        />
        <SegmentedControl
          value={type ?? "tous"}
          onChange={(v) => naviguer({ search: (s) => ({ ...s, type: v === "tous" ? undefined : (v as TypeContact) }) })}
          data={[{ value: "tous", label: "Tous" }, ...(["client", "entreprise", "apporteur", "partenaire"] as const).map((t) => ({ value: t, label: `${LIBELLES_TYPE_CONTACT[t]}s` }))]}
        />
      </Group>
      {contacts && contacts.length === 0 && (
        <Text size="sm" c="dimmed">
          Aucun contact{q ? " pour cette recherche" : ""}.
        </Text>
      )}
      {contacts && contacts.length > 0 &&
        (telephone ? (
          <Stack gap="xs">
            {contacts.map((c) => (
              <UnstyledButton key={c.id} onClick={() => ouvrir(c.id)}>
                <Card withBorder padding="sm">
                  <Group justify="space-between" wrap="nowrap">
                    <Text fw={600} size="sm" truncate>
                      {c.nom}
                    </Text>
                    <Badge size="sm" variant="light" color={c.prospect ? "orange" : undefined}>
                      {c.prospect ? "Prospect" : LIBELLES_TYPE_CONTACT[c.type]}
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed" truncate>
                    {[c.interlocuteur, c.corpsEtat, c.telephone].filter(Boolean).join(" · ")}
                  </Text>
                </Card>
              </UnstyledButton>
            ))}
          </Stack>
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nom</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Interlocuteur</Table.Th>
                <Table.Th>Corps d'état</Table.Th>
                <Table.Th>Téléphone</Table.Th>
                <Table.Th>E-mail</Table.Th>
                <Table.Th ta="right">Projets</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {contacts.map((c) => (
                <Table.Tr key={c.id} className="ligne-cliquable" onClick={() => ouvrir(c.id)}>
                  <Table.Td fw={600}>{c.nom}</Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={c.prospect ? "orange" : undefined}>
                      {c.prospect ? "Prospect" : LIBELLES_TYPE_CONTACT[c.type]}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{c.interlocuteur}</Table.Td>
                  <Table.Td>{c.corpsEtat}</Table.Td>
                  <Table.Td>{c.telephone}</Table.Td>
                  <Table.Td>
                    {c.email && (
                      <Anchor href={`mailto:${c.email}`} size="sm" onClick={(e) => e.stopPropagation()}>
                        {c.email}
                      </Anchor>
                    )}
                  </Table.Td>
                  <Table.Td ta="right">{c.nbProjets || ""}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ))}
      <ModalContact opened={creation} onClose={() => setCreation(false)} typeImpose={type} surCree={ouvrir} />
    </Stack>
  );
}
