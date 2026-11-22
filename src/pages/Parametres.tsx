import { useEffect, useState } from "react";
import { Button, Card, FileButton, Group, Image, Stack, Text, Textarea, TextInput, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { majReglagesRapport, reglagesRapport } from "../data/visites";
import { envoyerFichier, urlFichier } from "../lib/fichiers";
import { ecrire } from "../lib/query";
import { peutEcrire } from "../lib/session";

/** Textes types du rapport de visite, dans l'ordre où ils apparaissent. */
const TEXTES: [string, string][] = [
  ["reunion", "I – Réunion de chantier"],
  ["pointsGeneraux", "II – Points généraux"],
  ["nettoyage", "Nettoyage du chantier"],
  ["sousTraitance", "Sous-traitance"],
  ["facturation", "Facturation"],
  ["plans", "Plans d'exécution et de réservations"],
  ["materiaux", "IV – Choix des matériaux"],
  ["approvisionnements", "V – Approvisionnements"],
  ["reception", "VI – Pré-réception, réception, levée des réserves"],
  ["toutesEntreprises", "À toutes les entreprises"],
  ["securite", "Sécurité sur le chantier"],
  ["approbation", "Approbation du rapport précédent"],
];

/** Paramètres : rapport de visite (signataire, agence, signature, textes types). */
export function Parametres() {
  const { data } = useQuery({ queryKey: ["reglagesRapport"], queryFn: () => reglagesRapport() });
  const [textes, setTextes] = useState<Record<string, string>>({});
  const [signataire, setSignataire] = useState("");
  const [agence, setAgence] = useState("");
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    if (!data) return;
    setTextes(data.textes);
    setSignataire(data.signataire);
    setAgence(data.agence);
  }, [data]);
  if (!data) return null;
  const changerSignature = async (f: File | null) => {
    if (!f) return;
    setEnvoi(true);
    try {
      const r = await ecrire(() => envoyerFichier(f));
      if (r) await ecrire(() => majReglagesRapport({ signature: r.fichier }));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Stack p="xl" gap="md" maw={900}>
      <Title order={2}>Paramètres</Title>
      <Card withBorder>
        <Title order={4} mb="xs">
          Rapport de visite
        </Title>
        <Stack>
          <Group grow>
            <TextInput label="Signataire" placeholder="Prénom NOM, fonction" value={signataire} onChange={(e) => setSignataire(e.currentTarget.value)} />
            <TextInput label="Agence" placeholder="Agence, ville" value={agence} onChange={(e) => setAgence(e.currentTarget.value)} />
          </Group>
          <Group align="flex-end">
            {data.signature ? <Image src={urlFichier(data.signature)} alt="Signature" h={60} w="auto" fit="contain" /> : <Text size="sm" c="dimmed">Pas d'image de signature.</Text>}
            {peutEcrire() && (
              <FileButton onChange={changerSignature} accept="image/png,image/jpeg">
                {(props) => (
                  <Button {...props} size="xs" variant="default" loading={envoi}>
                    {data.signature ? "Changer la signature" : "Ajouter une signature (PNG sur fond blanc)"}
                  </Button>
                )}
              </FileButton>
            )}
          </Group>
          {TEXTES.map(([cle, libelle]) => (
            <Textarea key={cle} label={libelle} autosize minRows={2} value={textes[cle] ?? ""} onChange={(e) => setTextes({ ...textes, [cle]: e.currentTarget.value })} />
          ))}
          {peutEcrire() && (
            <Group justify="flex-end">
              <Button onClick={() => ecrire(() => majReglagesRapport({ textes, signataire, agence }))}>Enregistrer</Button>
            </Group>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
