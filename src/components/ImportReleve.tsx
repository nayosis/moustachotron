/*
 * Import du relevé bancaire CSV : lecture dans le navigateur, propositions du serveur (échéance encaissée, charge
 * récurrente, catégorie habituelle), relecture ligne par ligne, import d'un seul tenant.
 */
import { useState } from "react";
import { Alert, Badge, Button, Checkbox, FileButton, Group, Select, Stack, Table, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconFileSpreadsheet } from "@tabler/icons-react";
import { analyserReleve, importerReleve, type PropositionReleve } from "../data/releve";
import type { Categorie } from "../db/schema";
import { dateLisible } from "../lib/dates";
import { euros } from "../lib/montants";
import { ecrire } from "../lib/query";
import { lireReleve } from "../lib/releve";

type Ligne = PropositionReleve & { retenue: boolean; choix: string | null };

/** Texte d'un fichier : UTF-8, sinon Windows-1252 (exports bancaires plus anciens). */
async function lireTexte(f: File) {
  const octets = await f.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(octets);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(octets) : utf8;
}

export function ImportReleve({ categories }: { categories: Categorie[] }) {
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nom, setNom] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const options = (() => {
    const g = new Map<string, { value: string; label: string }[]>();
    for (const c of categories.filter((c) => !c.archive)) g.set(c.groupe, [...(g.get(c.groupe) ?? []), { value: c.id, label: c.libelle }]);
    return [...g].map(([group, items]) => ({ group, items }));
  })();

  const charger = async (f: File | null) => {
    if (!f) return;
    setErreur(null);
    setNom(f.name);
    const r = lireReleve(await lireTexte(f));
    if (r.erreur) {
      setErreur(r.erreur);
      setLignes(null);
      return;
    }
    const props = await ecrire(() => analyserReleve(r.lignes));
    if (!props) return;
    setLignes(props.map((p) => ({ ...p, retenue: !p.deja && !p.doublon, choix: p.echeance ? `echeance:${p.echeance.id}` : p.categorieId })));
  };

  const maj = (i: number, x: Partial<Ligne>) => setLignes((l) => l!.map((y, j) => (j === i ? { ...y, ...x } : y)));
  const retenues = (lignes ?? []).filter((l) => l.retenue);
  const incompletes = retenues.filter((l) => !l.choix);

  const importer = async () => {
    setEnvoi(true);
    try {
      const r = await ecrire(() =>
        importerReleve(
          retenues.map((l) => ({
            cle: l.cle,
            date: l.date,
            libelle: l.libelle,
            montant: l.montant,
            echeanceId: l.choix?.startsWith("echeance:") ? l.choix.slice(9) : null,
            categorieId: l.choix?.startsWith("echeance:") ? null : l.choix,
            chargeRecurrenteId: l.chargeRecurrenteId,
          })),
        ),
      );
      if (r) {
        notifications.show({ color: "green", message: `${r.crees} mouvement${r.crees > 1 ? "s" : ""} importé${r.crees > 1 ? "s" : ""}${r.ignorees ? `, ${r.ignorees} déjà présent${r.ignorees > 1 ? "s" : ""}` : ""}.` });
        setLignes(null);
      }
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Stack gap="md">
      <Group>
        <FileButton onChange={charger} accept=".csv,text/csv,text/plain">
          {(props) => (
            <Button {...props} leftSection={<IconFileSpreadsheet size={16} />}>
              Choisir le relevé (CSV)
            </Button>
          )}
        </FileButton>
        <Text size="sm" c="dimmed">
          Export CSV depuis l'espace en ligne de la banque. Rien n'est importé avant votre relecture ; une ligne déjà importée ne l'est jamais deux fois.
        </Text>
      </Group>
      {erreur && <Alert color="red">{erreur}</Alert>}
      {lignes && (
        <>
          <Text size="sm">
            <b>{nom}</b> : {lignes.length} lignes, {retenues.length} à importer
            {incompletes.length > 0 && (
              <Text span c="orange">
                {" "}
                — {incompletes.length} sans catégorie
              </Text>
            )}
            .
          </Text>
          <Table fz="sm" verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={30} />
                <Table.Th>Date</Table.Th>
                <Table.Th>Libellé</Table.Th>
                <Table.Th ta="right">Montant</Table.Th>
                <Table.Th w={320}>Ce que c'est</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lignes.map((l, i) => (
                <Table.Tr key={l.cle} style={{ opacity: l.retenue ? 1 : 0.55 }}>
                  <Table.Td>
                    <Checkbox checked={l.retenue} disabled={l.deja} onChange={(e) => maj(i, { retenue: e.currentTarget.checked })} aria-label="Importer cette ligne" />
                  </Table.Td>
                  <Table.Td>{dateLisible(l.date, { day: "numeric", month: "short" })}</Table.Td>
                  <Table.Td>
                    {l.libelle}
                    <Group gap={4} mt={2}>
                      {l.deja && (
                        <Badge size="xs" color="gray">
                          déjà importée
                        </Badge>
                      )}
                      {l.doublon && !l.deja && (
                        <Badge size="xs" color="orange" title={l.doublon.objet}>
                          déjà saisie ? {dateLisible(l.doublon.date, { day: "numeric", month: "short" })} · {l.doublon.objet.slice(0, 40)}
                        </Badge>
                      )}
                      {l.raison && (
                        <Badge size="xs" variant="light">
                          {l.raison}
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right" className="nombre" c={l.montant < 0 ? "red" : "green"}>
                    {euros(l.montant)}
                  </Table.Td>
                  <Table.Td>
                    <Select
                      size="xs"
                      searchable
                      disabled={!l.retenue}
                      placeholder="Catégorie…"
                      data={[...(l.echeance ? [{ group: "Échéance", items: [{ value: `echeance:${l.echeance.id}`, label: `Encaissement : ${l.echeance.libelle}` }] }] : []), ...options]}
                      value={l.choix}
                      onChange={(v) => maj(i, { choix: v })}
                      error={l.retenue && !l.choix}
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setLignes(null)}>
              Abandonner
            </Button>
            <Button loading={envoi} disabled={!retenues.length || incompletes.length > 0} onClick={importer}>
              Importer {retenues.length} ligne{retenues.length > 1 ? "s" : ""}
            </Button>
          </Group>
        </>
      )}
    </Stack>
  );
}
