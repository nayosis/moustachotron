import type { ReactNode } from "react";
import { ActionIcon, Anchor, Badge, Button, Card, Group, SimpleGrid, Stack, Text, Title, Tooltip, UnstyledButton } from "@mantine/core";
import { IconCalendarPlus, IconCheck, IconPlus } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { tableauDeBord } from "../data/accueil";
import { marquerFaite, reporterRelance } from "../data/interactions";
import { vueTresorerie } from "../data/tresorerie";
import { AvisMiseAJour } from "../components/MiseAJour";
import { aujourdhui, dateLisible } from "../lib/dates";
import { useEcran } from "../lib/ecran";
import { COLONNES } from "../lib/jalons";
import { LIBELLES_NATURE } from "../lib/libelles";
import { euros } from "../lib/montants";
import { ecrire } from "../lib/query";
import { useSaisie } from "../lib/saisie";
import { peutEcrire } from "../lib/session";

/** « Mardi 27 octobre 2026 ». */
function aujourdhuiLong() {
  const t = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Chiffre clé, cliquable : libellé, valeur, précision. `accent` : la tuile principale. */
export function Tuile({ label, valeur, detail, onClick, accent }: { label: string; valeur: ReactNode; detail?: ReactNode; onClick?: () => void; accent?: boolean }) {
  const contenu = (
    <Card withBorder={!accent} padding="md" bg={accent ? "marque.7" : undefined} className={onClick ? "tuile" : undefined} h="100%">
      <Text size="sm" c={accent ? "marque.0" : "dimmed"}>
        {label}
      </Text>
      <Text fz={28} fw={700} lh={1.2} mt={4} c={accent ? "white" : undefined}>
        {valeur}
      </Text>
      {detail && (
        <Text size="xs" c={accent ? "marque.0" : "dimmed"} mt={2} truncate>
          {detail}
        </Text>
      )}
    </Card>
  );
  return onClick ? (
    <UnstyledButton onClick={onClick} style={{ display: "block" }}>
      {contenu}
    </UnstyledButton>
  ) : (
    contenu
  );
}

/** Date courte « 24 nov. ». */
const court = (d: string) => dateLisible(d, { day: "numeric", month: "short" });

/** Dans N jours (« AAAA-MM-JJ »). */
function dansJours(n: number) {
  const d = new Date(`${aujourdhui()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function Vide({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" c="dimmed">
      {children}
    </Text>
  );
}

/** Accueil : ce qui demande une action aujourd'hui (relances, jalons, attestations) et l'état du portefeuille. */
export function Accueil() {
  const { telephone } = useEcran();
  const naviguer = useNavigate();
  const { nouveauProjet, nouvelEchange } = useSaisie();
  const { data: a } = useQuery({ queryKey: ["tableauDeBord"], queryFn: () => tableauDeBord() });
  const { data: t } = useQuery({ queryKey: ["tresorerie", null, false], queryFn: () => vueTresorerie() });
  const finDuMois = t?.horizons.find((h) => h.libelle === "Fin du mois");

  return (
    <Stack p={telephone ? "md" : "xl"} gap="lg" maw={1200}>
      <AvisMiseAJour />
      <Group justify="space-between">
        <div>
          <Title order={2}>Aujourd'hui</Title>
          <Text c="dimmed" size="sm">
            {aujourdhuiLong()}
          </Text>
        </div>
        {peutEcrire() && !telephone && (
          <Group gap="xs">
            <Button variant="default" leftSection={<IconPlus size={16} />} onClick={nouvelEchange}>
              Échange
            </Button>
            <Button leftSection={<IconPlus size={16} />} onClick={nouveauProjet}>
              Nouveau projet
            </Button>
          </Group>
        )}
      </Group>
      {a && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }}>
            <Tuile
              accent
              label="Trésorerie"
              valeur={t ? euros(t.soldeReel) : "…"}
              detail={finDuMois ? `fin du mois : ${euros(finDuMois.solde)}` : t?.retards.length ? `${t.retards.length} échéance(s) en retard` : "aujourd'hui"}
              onClick={() => naviguer({ to: "/tresorerie" })}
            />
            <Tuile label="Projets en cours" valeur={a.enCours} detail={`${euros(a.honorairesHt)} HT d'honoraires`} onClick={() => naviguer({ to: "/projets" })} />
            <Tuile label="Avant-vente" valeur={(a.parColonne.prospect ?? 0) + (a.parColonne.visite ?? 0) + (a.parColonne.consultation ?? 0)} detail="prospects, visites, consultations" onClick={() => naviguer({ to: "/projets" })} />
            <Tuile label="Chantiers" valeur={(a.parColonne.preparation ?? 0) + (a.parColonne.chantier ?? 0)} detail="en préparation ou en cours" onClick={() => naviguer({ to: "/projets" })} />
            <Tuile label="À relancer" valeur={a.relances.length + a.sansNouvelles.length} detail="aujourd'hui ou en retard" />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <Card withBorder padding="md">
              <Title order={4} mb="sm">
                À relancer
              </Title>
              <Stack gap="xs">
                {a.relances.length === 0 && a.sansNouvelles.length === 0 && <Vide>Rien à relancer aujourd'hui.</Vide>}
                {a.relances.map((r) => (
                  <Group key={r.id} justify="space-between" wrap="nowrap" gap="xs">
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" truncate>
                        <Anchor renderRoot={(r) => <Link {...r} to="/contacts/$id" params={{ id: r.contactId }} />} fw={600}>
                          {r.contactNom}
                        </Anchor>{" "}
                        — {r.objet}
                      </Text>
                      <Text size="xs" c={r.aFaireLe! < aujourdhui() ? "red" : "dimmed"}>
                        {LIBELLES_NATURE[r.nature]} · prévu le {court(r.aFaireLe!)}
                        {r.projetReference && (
                          <>
                            {" · "}
                            <Anchor renderRoot={(r) => <Link {...r} to="/projets/$id" params={{ id: r.projetId! }} />} size="xs">
                              {r.projetReference}
                            </Anchor>
                          </>
                        )}
                      </Text>
                    </div>
                    {peutEcrire() && (
                      <Group gap={4} wrap="nowrap">
                        <Tooltip label="Reporter d'une semaine">
                          <ActionIcon variant="subtle" color="gray" aria-label="Reporter d'une semaine" onClick={() => ecrire(() => reporterRelance(r.id, dansJours(7)))}>
                            <IconCalendarPlus size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Fait">
                          <ActionIcon variant="light" aria-label="Fait" onClick={() => ecrire(() => marquerFaite(r.id, true))}>
                            <IconCheck size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    )}
                  </Group>
                ))}
                {a.sansNouvelles.map((p) => (
                  <Group key={p.id} justify="space-between" wrap="nowrap">
                    <Text size="sm" truncate>
                      <Anchor renderRoot={(r) => <Link {...r} to="/projets/$id" params={{ id: p.id }} />} fw={600}>
                        {p.contactNom}
                      </Anchor>{" "}
                      — estimation sans réponse
                    </Text>
                    <Badge color="orange" variant="light">
                      depuis le {court(p.dernier)}
                    </Badge>
                  </Group>
                ))}
              </Stack>
            </Card>

            <Card withBorder padding="md">
              <Title order={4} mb="sm">
                Jalons des 14 prochains jours
              </Title>
              <Stack gap="xs">
                {a.aVenir.length === 0 && <Vide>Aucun jalon prévu. Datez les prochaines étapes sur les fiches projet.</Vide>}
                {a.aVenir.map((j) => (
                  <Group key={j.id} justify="space-between" wrap="nowrap">
                    <Text size="sm" truncate>
                      <Anchor renderRoot={(r) => <Link {...r} to="/projets/$id" params={{ id: j.id }} />} fw={600}>
                        {j.clientNom}
                      </Anchor>{" "}
                      — {j.jalon}
                    </Text>
                    <Badge color={j.enRetard ? "red" : "marque"} variant="light">
                      {j.enRetard ? "en retard · " : ""}
                      {court(j.date)}
                    </Badge>
                  </Group>
                ))}
              </Stack>
            </Card>
          </SimpleGrid>

          {a.attestations.length > 0 && (
            <Card withBorder padding="md">
              <Title order={4} mb="sm">
                Attestations d'assurance à renouveler
              </Title>
              <Stack gap="xs">
                {a.attestations.map((x) => (
                  <Group key={x.id} justify="space-between" wrap="nowrap">
                    <Text size="sm">
                      <Anchor renderRoot={(r) => <Link {...r} to="/contacts/$id" params={{ id: x.id }} />} fw={600}>
                        {x.nom}
                      </Anchor>
                      {x.projets > 0 && ` — ${x.projets} projet${x.projets > 1 ? "s" : ""} en cours`}
                    </Text>
                    <Badge color={x.expiree ? "red" : "orange"} variant="light">
                      {x.expiree ? "expirée le" : "expire le"} {court(x.fin)}
                    </Badge>
                  </Group>
                ))}
              </Stack>
            </Card>
          )}

          {!telephone && (
            <Text size="xs" c="dimmed">
              Pipeline : {COLONNES.filter((c) => c.code !== "clos" && a.parColonne[c.code]).map((c) => `${c.libelle} ${a.parColonne[c.code]}`).join(" · ") || "aucun projet en cours"}.
            </Text>
          )}
        </>
      )}
    </Stack>
  );
}
