import { useEffect, useState } from "react";
import { ActionIcon, Anchor, Badge, Button, Card, FileButton, Group, Modal, Select, Stack, Text, Title, Tooltip } from "@mantine/core";
import { IconCamera, IconPaperclip, IconTrash } from "@tabler/icons-react";
import { ajouterDocuments, retirerDocument, type CibleDocument, type FichierARattacher } from "../data/documents";
import type { Document } from "../db/schema";
import { aujourdhui, dateLisible } from "../lib/dates";
import { libelleTypeDocument, tailleLisible, TYPES_DOCUMENTS } from "../lib/documents";
import { useEcran } from "../lib/ecran";
import { envoyerFichier, urlFichier } from "../lib/fichiers";
import { ecrire } from "../lib/query";
import { peutEcrire } from "../lib/session";
import { ChampDate } from "./Champs";

/** Types acceptés à l'envoi. Pas de image/heic : iOS convertit alors de lui-même la photo en JPEG. */
export const TYPES_ACCEPTES =
  "application/pdf,image/jpeg,image/png,image/webp,image/gif,.doc,.docx,.xls,.xlsx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Envoie des fichiers puis les rattache ; renvoie la liste envoyée (vide si erreur). */
export async function envoyerTous(fichiers: File[]) {
  const envoyes: FichierARattacher[] = [];
  for (const f of fichiers) {
    const r = await ecrire(() => envoyerFichier(f));
    if (r) envoyes.push({ fichier: r.fichier, nom: r.nom });
  }
  return envoyes;
}

/** Ajout de documents : type, fichiers (photo directe sur téléphone), fin de validité pour une attestation. */
export function ModalDocument({ opened, onClose, cible, types, typeParDefaut }: { opened: boolean; onClose: () => void; cible: CibleDocument; types: string[]; typeParDefaut?: string }) {
  const { telephone } = useEcran();
  const [type, setType] = useState<string | null>(typeParDefaut ?? types[0]);
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [validite, setValidite] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    if (!opened) return;
    setType(typeParDefaut ?? types[0]);
    setFichiers([]);
    setValidite(null);
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const avecValidite = TYPES_DOCUMENTS.find((t) => t.code === type)?.validite;
  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const envoyes = await envoyerTous(fichiers);
      if (envoyes.length !== fichiers.length) return;
      const ok = await ecrire(() => ajouterDocuments(cible, type!, envoyes, avecValidite ? validite : null).then(() => true));
      if (ok) onClose();
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Ajouter des documents">
      <Stack>
        <Select label="Type" data={types.map((t) => ({ value: t, label: libelleTypeDocument(t) }))} value={type} onChange={setType} allowDeselect={false} />
        {avecValidite && <ChampDate label="Valide jusqu'au" required value={validite} onChange={setValidite} />}
        <Group gap="xs">
          {telephone && (
            <FileButton onChange={(f) => f && setFichiers((x) => [...x, f])} accept="image/jpeg,image/png" capture="environment">
              {(props) => (
                <Button {...props} variant="light" leftSection={<IconCamera size={16} />}>
                  Photo
                </Button>
              )}
            </FileButton>
          )}
          <FileButton onChange={(f) => setFichiers((x) => [...x, ...f])} accept={TYPES_ACCEPTES} multiple>
            {(props) => (
              <Button {...props} variant="default" leftSection={<IconPaperclip size={16} />}>
                Choisir des fichiers
              </Button>
            )}
          </FileButton>
        </Group>
        {fichiers.map((f, i) => (
          <Text key={i} size="sm">
            {f.name}{" "}
            <Text span c="dimmed">
              ({tailleLisible(f.size)})
            </Text>
          </Text>
        ))}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={enregistrer} loading={envoi} disabled={!type || !fichiers.length || (avecValidite && !validite)}>
            Ajouter
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Liste de documents (non retirés), groupés par type, avec retrait et badge de validité. */
export function ListeDocuments({ documents, titre = "Documents", cible, types }: { documents: Document[]; titre?: string; cible: CibleDocument; types: string[] }) {
  const [ajout, setAjout] = useState(false);
  const actifs = documents.filter((d) => !d.archive);
  const ordre = TYPES_DOCUMENTS.map((t) => t.code);
  const groupes = [...new Set(actifs.map((d) => d.type))].sort((a, b) => ordre.indexOf(a) - ordre.indexOf(b));
  const aujd = aujourdhui();
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <Title order={4}>{titre}</Title>
        {peutEcrire() && (
          <Button size="xs" variant="light" leftSection={<IconPaperclip size={14} />} onClick={() => setAjout(true)}>
            Ajouter
          </Button>
        )}
      </Group>
      {actifs.length === 0 && (
        <Text size="sm" c="dimmed">
          Aucun document.
        </Text>
      )}
      <Stack gap="sm">
        {groupes.map((g) => (
          <div key={g}>
            <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={2}>
              {libelleTypeDocument(g)}
            </Text>
            <Stack gap={4}>
              {actifs
                .filter((d) => d.type === g)
                .map((d) => (
                  <Group key={d.id} justify="space-between" wrap="nowrap">
                    <Anchor href={urlFichier(d.fichier)} target="_blank" size="sm" truncate>
                      {d.nom}
                    </Anchor>
                    <Group gap="xs" wrap="nowrap">
                      {d.valideJusquAu && (
                        <Badge size="sm" variant="light" color={d.valideJusquAu < aujd ? "red" : "green"}>
                          {d.valideJusquAu < aujd ? "expirée le" : "valide jusqu'au"} {dateLisible(d.valideJusquAu, { day: "numeric", month: "short", year: "numeric" })}
                        </Badge>
                      )}
                      <Text size="xs" c="dimmed">
                        {tailleLisible(d.taille)}
                      </Text>
                      {peutEcrire() && (
                        <Tooltip label="Retirer (reste consultable depuis le journal)">
                          <ActionIcon variant="subtle" color="gray" onClick={() => ecrire(() => retirerDocument(d.id))} aria-label="Retirer">
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  </Group>
                ))}
            </Stack>
          </div>
        ))}
      </Stack>
      <ModalDocument opened={ajout} onClose={() => setAjout(false)} cible={cible} types={types} />
    </Card>
  );
}
