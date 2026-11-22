import { useState } from "react";
import { Anchor, Badge, Button, Card, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconArchive, IconArrowLeft, IconPencil, IconPlus } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { archiverContact, ficheContact } from "../data/contacts";
import { marquerFaite } from "../data/interactions";
import { ListeDocuments } from "../components/Documents";
import { ModalContact, ModalEchange, ModalProjet } from "../components/Formulaires";
import { Historique } from "../components/Historique";
import { dateLisible } from "../lib/dates";
import { useEcran } from "../lib/ecran";
import { LIBELLES_ISSUE, LIBELLES_NATURE, LIBELLES_TYPE_CONTACT } from "../lib/libelles";
import { ecrire } from "../lib/query";
import { estAdmin, peutEcrire } from "../lib/session";
import { ficheContactRoute } from "../router";

const court = (d: string) => dateLisible(d, { day: "numeric", month: "short", year: "numeric" });

/** Un contact : coordonnées, projets (client ou apporteur), lots tenus (entreprise), échanges, attestations. */
export function FicheContact() {
  const { id } = ficheContactRoute.useParams();
  const { telephone } = useEcran();
  const { data: c, error } = useQuery({ queryKey: ["contact", id], queryFn: () => ficheContact(id) });
  const [modifier, setModifier] = useState(false);
  const [echange, setEchange] = useState(false);
  const [projet, setProjet] = useState(false);
  if (error) return <Text p="xl">{error.message}</Text>;
  if (!c) return null;

  return (
    <Stack p={telephone ? "md" : "xl"} gap="md" maw={1100}>
      <Group justify="space-between">
        <Anchor component={Link} to="/contacts" size="sm">
          <Group gap={4}>
            <IconArrowLeft size={14} /> Contacts
          </Group>
        </Anchor>
        {peutEcrire() && (
          <Group gap="xs">
            <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setEchange(true)}>
              Échange
            </Button>
            {c.type === "client" && (
              <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setProjet(true)}>
                Projet
              </Button>
            )}
            <Button size="xs" variant="default" leftSection={<IconPencil size={14} />} onClick={() => setModifier(true)}>
              Modifier
            </Button>
            <Button size="xs" variant="subtle" color="gray" leftSection={<IconArchive size={14} />} onClick={() => ecrire(() => archiverContact(c.id, !c.archive))}>
              {c.archive ? "Désarchiver" : "Archiver"}
            </Button>
          </Group>
        )}
      </Group>
      <div>
        <Group gap="xs">
          <Title order={2}>{c.nom}</Title>
          <Badge variant="light">{LIBELLES_TYPE_CONTACT[c.type]}</Badge>
          {c.archive && <Badge color="gray">Archivé</Badge>}
        </Group>
        <Group gap="md" mt={4}>
          {c.interlocuteur && <Text size="sm">{c.interlocuteur}</Text>}
          {c.corpsEtat && <Text size="sm">{c.corpsEtat}</Text>}
          {c.telephone && (
            <Anchor href={`tel:${c.telephone}`} size="sm">
              {c.telephone}
            </Anchor>
          )}
          {c.email && (
            <Anchor href={`mailto:${c.email}`} size="sm">
              {c.email}
            </Anchor>
          )}
          {c.adresse && (
            <Text size="sm" c="dimmed">
              {c.adresse}
            </Text>
          )}
        </Group>
        {c.notes && (
          <Text size="sm" mt="xs" style={{ whiteSpace: "pre-wrap" }}>
            {c.notes}
          </Text>
        )}
      </div>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Title order={4} mb="xs">
            {c.type === "entreprise" ? "Lots tenus" : "Projets"}
          </Title>
          <Stack gap={6}>
            {c.type === "entreprise"
              ? c.lots.map((l) => (
                  <Text key={l.lotId} size="sm">
                    <Anchor renderRoot={(r) => <Link {...r} to="/projets/$id" params={{ id: l.projetId }} />}>
                      {l.reference}
                    </Anchor>{" "}
                    {l.intitule} — lot {l.numero} {l.corpsEtat}
                  </Text>
                ))
              : c.projets.map((p) => (
                  <Group key={p.id} justify="space-between" wrap="nowrap">
                    <Text size="sm" truncate>
                      <Anchor renderRoot={(r) => <Link {...r} to="/projets/$id" params={{ id: p.id }} />}>
                        {p.reference}
                      </Anchor>{" "}
                      {p.intitule}
                    </Text>
                    <Group gap={4} wrap="nowrap">
                      {p.apporteur && (
                        <Badge size="sm" variant="light" color="grape">
                          apporté
                        </Badge>
                      )}
                      <Badge size="sm" variant="light" color={p.issue === "en_cours" ? undefined : "red"}>
                        {p.missionCode} · {LIBELLES_ISSUE[p.issue]}
                      </Badge>
                    </Group>
                  </Group>
                ))}
            {(c.type === "entreprise" ? c.lots.length : c.projets.length) === 0 && (
              <Text size="sm" c="dimmed">
                Aucun pour l'instant.
              </Text>
            )}
          </Stack>
        </Card>
        <Card withBorder>
          <Title order={4} mb="xs">
            Échanges
          </Title>
          {c.interactions.length === 0 && (
            <Text size="sm" c="dimmed">
              Aucun échange.
            </Text>
          )}
          <Stack gap="xs">
            {c.interactions.map((i) => (
              <div key={i.id}>
                <Group justify="space-between" wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    {court(i.date)}
                    {i.heure ? ` à ${i.heure}` : ""} · {LIBELLES_NATURE[i.nature]}
                  </Text>
                  {i.aFaireLe && (
                    <Badge
                      size="xs"
                      variant="light"
                      color={i.faite ? "gray" : "orange"}
                      style={{ cursor: peutEcrire() ? "pointer" : undefined }}
                      onClick={() => peutEcrire() && ecrire(() => marquerFaite(i.id, !i.faite))}
                      title={i.faite ? "Relance faite (cliquer pour la remettre à faire)" : "Cliquer quand la relance est faite"}
                    >
                      {i.faite ? "relance faite" : `relance ${court(i.aFaireLe)}`}
                    </Badge>
                  )}
                </Group>
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
      </SimpleGrid>

      {c.type === "entreprise" && <ListeDocuments titre="Assurances et documents" documents={c.documents} cible={{ contactId: c.id }} types={["attestation_assurance", "autre"]} />}

      {estAdmin() && !telephone && <Historique id={id} />}

      <ModalContact opened={modifier} onClose={() => setModifier(false)} initial={c} />
      <ModalEchange opened={echange} onClose={() => setEchange(false)} contactId={c.id} />
      <ModalProjet opened={projet} onClose={() => setProjet(false)} clientId={c.id} />
    </Stack>
  );
}
