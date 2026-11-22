/*
 * Échéances : facturer (n°, date, montant), régler (date, mode → mouvement de trésorerie), annuler un règlement.
 * Utilisé par la fiche projet et la page Trésorerie.
 */
import { useEffect, useState } from "react";
import { ActionIcon, Anchor, Badge, Button, Group, Menu, Modal, Select, Stack, Table, Text, TextInput } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { IconDots, IconFileInvoice, IconCash, IconArrowBackUp, IconCalendar } from "@tabler/icons-react";
import { annulerReglement, facturerEcheance, forcerDateEcheance, reglerEcheance, type ModeReglement } from "../data/echeances";
import { aujourdhui, dateLisible } from "../lib/dates";
import { libelleJalon } from "../lib/jalons";
import { euros, lireMontant } from "../lib/montants";
import { ecrire } from "../lib/query";
import { peutEcrire } from "../lib/session";
import { ChampDate } from "./Champs";

export type EcheanceAffichee = {
  id: string;
  libelle: string;
  sens: "entree" | "sortie";
  ttc: number;
  ht: number;
  statut: "prevue" | "facturee" | "reglee";
  numeroFacture: string | null;
  date: string | null;
  jalon?: string;
  dateReglement?: string | null;
  /** Projet (page Trésorerie). */
  projetLibelle?: string;
  projetId?: string;
};

export const LIBELLES_MODE: Record<ModeReglement, string> = { virement: "Virement", prelevement: "Prélèvement", cb: "Carte", cheque: "Chèque", especes: "Espèces", autre: "Autre" };
const STATUT: Record<string, [string, string]> = { prevue: ["Prévue", "gray"], facturee: ["Facturée", "blue"], reglee: ["Réglée", "green"] };
const court = (d: string | null | undefined) => (d ? dateLisible(d, { day: "numeric", month: "short", year: "numeric" }) : "");

/** Facturer une échéance. */
export function ModalFacturer({ e, onClose }: { e: EcheanceAffichee | null; onClose: () => void }) {
  const [numero, setNumero] = useState("");
  const [date, setDate] = useState<string | null>(aujourdhui());
  const [montant, setMontant] = useState("");
  useEffect(() => {
    if (!e) return;
    setNumero(e.numeroFacture ?? "");
    setDate(aujourdhui());
    setMontant((e.ttc / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2 }));
  }, [e]);
  const m = lireMontant(montant);
  return (
    <Modal opened={!!e} onClose={onClose} title={e ? `Facturer : ${e.libelle}` : ""}>
      <Stack>
        <TextInput label="N° de facture" required value={numero} onChange={(x) => setNumero(x.currentTarget.value)} data-autofocus />
        <ChampDate label="Date de la facture" required value={date} onChange={setDate} />
        <TextInput label="Montant TTC facturé (€)" value={montant} onChange={(x) => setMontant(x.currentTarget.value)} error={montant && !m ? "Montant illisible" : undefined} description="Le HT suit au même taux" />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!numero.trim() || !date || !m} onClick={async () => (await ecrire(() => facturerEcheance(e!.id, { numero, date: date!, ttc: m }).then(() => true))) && onClose()}>
            Facturer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Régler une échéance : crée le mouvement de trésorerie. */
export function ModalRegler({ e, onClose }: { e: EcheanceAffichee | null; onClose: () => void }) {
  const [date, setDate] = useState<string | null>(aujourdhui());
  const [mode, setMode] = useState<ModeReglement>("virement");
  useEffect(() => {
    if (e) setDate(aujourdhui());
  }, [e]);
  return (
    <Modal opened={!!e} onClose={onClose} title={e ? `${e.sens === "entree" ? "Encaissement" : "Paiement"} : ${e.libelle}` : ""}>
      {e && (
        <Stack>
          <Text size="sm">
            {e.sens === "entree" ? "Encaissé" : "Payé"} : <b>{euros(e.ttc)} TTC</b> ({euros(e.ht)} HT){e.numeroFacture ? ` — facture ${e.numeroFacture}` : ""}
          </Text>
          <ChampDate label={e.sens === "entree" ? "Encaissé le" : "Payé le"} required value={date} onChange={setDate} />
          <Select label="Mode" data={Object.entries(LIBELLES_MODE).map(([value, label]) => ({ value, label }))} value={mode} onChange={(x) => x && setMode(x as ModeReglement)} allowDeselect={false} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Annuler
            </Button>
            <Button disabled={!date} onClick={async () => (await ecrire(() => reglerEcheance(e.id, { date: date!, mode }))) && onClose()}>
              Enregistrer
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

/** Forcer la date d'une échéance (sinon celle de son jalon). */
function ModalDate({ e, onClose }: { e: EcheanceAffichee | null; onClose: () => void }) {
  const [date, setDate] = useState<string | null>(null);
  useEffect(() => {
    if (e) setDate(e.date);
  }, [e]);
  return (
    <Modal opened={!!e} onClose={onClose} title="Date de l'échéance">
      <Stack>
        <Text size="sm" c="dimmed">
          Par défaut, l'échéance suit la date de son jalon{e?.jalon ? ` (« ${libelleJalon(e.jalon)} »)` : ""}. Une date forcée la remplace.
        </Text>
        <ChampDate label="Date forcée" value={date} onChange={setDate} />
        <Group justify="space-between">
          <Button variant="subtle" color="gray" onClick={async () => (await ecrire(() => forcerDateEcheance(e!.id, null).then(() => true))) && onClose()}>
            Suivre le jalon
          </Button>
          <Button disabled={!date} onClick={async () => (await ecrire(() => forcerDateEcheance(e!.id, date).then(() => true))) && onClose()}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Tableau d'échéances avec leurs actions. `avecProjet` : colonne du projet (page Trésorerie). */
export function TableEcheances({ echeances, avecProjet, compact }: { echeances: EcheanceAffichee[]; avecProjet?: boolean; compact?: boolean }) {
  const [facturer, setFacturer] = useState<EcheanceAffichee | null>(null);
  const [regler, setRegler] = useState<EcheanceAffichee | null>(null);
  const [dater, setDater] = useState<EcheanceAffichee | null>(null);
  const aujd = aujourdhui();
  return (
    <>
      <Table verticalSpacing={4} fz="sm">
        <Table.Tbody>
          {echeances.map((e) => {
            const [statut, couleur] = STATUT[e.statut];
            const retard = e.statut !== "reglee" && e.date && e.date < aujd;
            return (
              <Table.Tr key={e.id}>
                <Table.Td>
                  {avecProjet &&
                    (e.projetId ? (
                      <Anchor size="xs" renderRoot={(r) => <Link {...r} to="/projets/$id" params={{ id: e.projetId! }} />}>
                        {e.projetLibelle}
                      </Anchor>
                    ) : (
                      <Text size="xs" c="dimmed">
                        {e.projetLibelle}
                      </Text>
                    ))}
                  <Text size="sm">{e.libelle}</Text>
                  <Text size="xs" c={retard ? "red" : "dimmed"}>
                    {e.statut === "reglee" ? `réglée le ${court(e.dateReglement)}` : e.date ? `${retard ? "en retard · " : ""}${court(e.date)}` : `à dater${e.jalon ? ` (${libelleJalon(e.jalon)})` : ""}`}
                    {e.numeroFacture ? ` · facture ${e.numeroFacture}` : ""}
                  </Text>
                </Table.Td>
                <Table.Td ta="right" className="nombre">
                  <Text size="sm" c={e.sens === "sortie" ? "red" : undefined}>
                    {e.sens === "sortie" ? "− " : ""}
                    {euros(e.ttc)}
                  </Text>
                  {!compact && (
                    <Text size="xs" c="dimmed">
                      {euros(e.ht)} HT
                    </Text>
                  )}
                </Table.Td>
                <Table.Td w={100}>
                  <Badge size="sm" variant="light" color={couleur}>
                    {statut}
                  </Badge>
                </Table.Td>
                {peutEcrire() && (
                  <Table.Td w={36}>
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <ActionIcon variant="subtle" color="gray" aria-label="Actions de l'échéance">
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {e.statut !== "reglee" && e.sens === "entree" && (
                          <Menu.Item leftSection={<IconFileInvoice size={14} />} onClick={() => setFacturer(e)}>
                            {e.statut === "facturee" ? "Corriger la facture" : "Facturer"}
                          </Menu.Item>
                        )}
                        {e.statut !== "reglee" && (
                          <Menu.Item leftSection={<IconCash size={14} />} onClick={() => setRegler(e)}>
                            {e.sens === "entree" ? "Encaissée" : "Payée"}
                          </Menu.Item>
                        )}
                        {e.statut !== "reglee" && (
                          <Menu.Item leftSection={<IconCalendar size={14} />} onClick={() => setDater(e)}>
                            Changer la date
                          </Menu.Item>
                        )}
                        {e.statut === "reglee" && (
                          <Menu.Item leftSection={<IconArrowBackUp size={14} />} onClick={() => ecrire(() => annulerReglement(e.id))}>
                            Annuler le règlement
                          </Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                )}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      <ModalFacturer e={facturer} onClose={() => setFacturer(null)} />
      <ModalRegler e={regler} onClose={() => setRegler(null)} />
      <ModalDate e={dater} onClose={() => setDater(null)} />
    </>
  );
}
