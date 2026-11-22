/*
 * Fenêtres de saisie partagées : contact, projet, échange (relance). Plein écran sur téléphone (styles.css).
 */
import { useEffect, useState } from "react";
import { Button, Group, Modal, SegmentedControl, Select, Stack, Textarea, TextInput } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { creerContact, listeContacts, majContact, type SaisieContact, type TypeContact } from "../data/contacts";
import { creerInteraction, type NatureInteraction } from "../data/interactions";
import { creerProjet, listeProjets, referentiels } from "../data/projets";
import { aujourdhui } from "../lib/dates";
import { LIBELLES_NATURE, LIBELLES_TYPE_CONTACT, options } from "../lib/libelles";
import { ecrire } from "../lib/query";
import { ChampDate } from "./Champs";

/** Contacts d'un ou plusieurs types, en options de Select (« Nom — interlocuteur »). */
export function useOptionsContacts(types: TypeContact[]) {
  const { data } = useQuery({ queryKey: ["contacts", "options"], queryFn: () => listeContacts() });
  return (data ?? []).filter((c) => types.includes(c.type)).map((c) => ({ value: c.id, label: c.interlocuteur ? `${c.nom} — ${c.interlocuteur}` : c.nom }));
}

const VIDE: SaisieContact = { type: "client", nom: "", interlocuteur: "", corpsEtat: "", telephone: "", email: "", adresse: "", notes: "" };

/** Création ou modification d'un contact. `surCree` reçoit l'id du contact créé. */
export function ModalContact({
  opened,
  onClose,
  initial,
  typeImpose,
  surCree,
}: {
  opened: boolean;
  onClose: () => void;
  initial?: (SaisieContact & { id: string; modifieLe: string | null }) | null;
  typeImpose?: TypeContact;
  surCree?: (id: string) => void;
}) {
  const [v, setV] = useState<SaisieContact>(VIDE);
  useEffect(() => {
    if (opened) setV(initial ? { ...VIDE, ...initial } : { ...VIDE, type: typeImpose ?? "client" });
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const champ = (k: keyof SaisieContact) => ({ value: (v[k] as string) ?? "", onChange: (e: { currentTarget: { value: string } }) => setV({ ...v, [k]: e.currentTarget.value }) });
  const enregistrer = async () => {
    if (initial) {
      const r = await ecrire(() => majContact(initial.id, v, initial.modifieLe));
      if (r) onClose();
      return;
    }
    const id = await ecrire(() => creerContact(v));
    if (id) {
      onClose();
      surCree?.(id);
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} title={initial ? "Modifier le contact" : "Nouveau contact"} size="lg">
      <Stack>
        {!typeImpose && <Select label="Type" data={options(LIBELLES_TYPE_CONTACT)} value={v.type} onChange={(t) => t && setV({ ...v, type: t as TypeContact })} allowDeselect={false} />}
        <TextInput label="Nom" description={v.type === "client" ? "« Famille Martin », « M. et Mme Roux »" : "Raison sociale ou nom"} required {...champ("nom")} data-autofocus />
        <TextInput label="Interlocuteur" description="Personne à joindre" {...champ("interlocuteur")} />
        {v.type === "entreprise" && <TextInput label="Corps d'état" placeholder="Électricité, maçonnerie…" {...champ("corpsEtat")} />}
        <Group grow>
          <TextInput label="Téléphone" type="tel" {...champ("telephone")} />
          <TextInput label="E-mail" type="email" {...champ("email")} />
        </Group>
        <TextInput label="Adresse" {...champ("adresse")} />
        <Textarea label="Notes" autosize minRows={2} {...champ("notes")} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={enregistrer} disabled={!v.nom.trim()}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Nouveau projet : client existant ou nouveau prospect, mission, origine, apporteur. Ouvre la fiche créée. */
export function ModalProjet({ opened, onClose, clientId }: { opened: boolean; onClose: () => void; clientId?: string }) {
  const naviguer = useNavigate();
  const { data: ref } = useQuery({ queryKey: ["referentiels"], queryFn: () => referentiels() });
  const clients = useOptionsContacts(["client"]);
  const apporteurs = useOptionsContacts(["apporteur", "partenaire", "client", "autre"]);
  const [nouveau, setNouveau] = useState("existant");
  const [client, setClient] = useState<string | null>(null);
  const [nc, setNc] = useState({ nom: "", interlocuteur: "", telephone: "", email: "" });
  const [intitule, setIntitule] = useState("");
  const [missionCode, setMission] = useState<string | null>("AMO");
  const [origineCode, setOrigine] = useState<string | null>(null);
  const [apporteurId, setApporteur] = useState<string | null>(null);
  const [adresse, setAdresse] = useState("");
  const [recuLe, setRecuLe] = useState<string | null>(aujourdhui());
  useEffect(() => {
    if (!opened) return;
    setNouveau(clientId ? "existant" : "nouveau");
    setClient(clientId ?? null);
    setNc({ nom: "", interlocuteur: "", telephone: "", email: "" });
    setIntitule("");
    setMission("AMO");
    setOrigine(null);
    setApporteur(null);
    setAdresse("");
    setRecuLe(aujourdhui());
  }, [opened, clientId]);
  const valide = intitule.trim() && missionCode && origineCode && (nouveau === "nouveau" ? nc.nom.trim() : client);
  const enregistrer = async () => {
    const id = await ecrire(() =>
      creerProjet({
        intitule,
        missionCode: missionCode!,
        origineCode: origineCode!,
        apporteurId,
        adresse,
        recuLe,
        clientId: nouveau === "existant" ? client : null,
        nouveauClient: nouveau === "nouveau" ? nc : null,
      }),
    );
    if (!id) return;
    onClose();
    naviguer({ to: "/projets/$id", params: { id } });
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Nouveau projet" size="lg">
      <Stack>
        <SegmentedControl
          value={nouveau}
          onChange={setNouveau}
          data={[
            { value: "nouveau", label: "Nouveau prospect" },
            { value: "existant", label: "Client existant" },
          ]}
        />
        {nouveau === "existant" ? (
          <Select label="Client" searchable data={clients} value={client} onChange={setClient} required nothingFoundMessage="Aucun client" />
        ) : (
          <>
            <TextInput label="Nom du prospect" required placeholder="Famille Martin" value={nc.nom} onChange={(e) => setNc({ ...nc, nom: e.currentTarget.value })} data-autofocus />
            <Group grow>
              <TextInput label="Téléphone" type="tel" value={nc.telephone} onChange={(e) => setNc({ ...nc, telephone: e.currentTarget.value })} />
              <TextInput label="E-mail" type="email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.currentTarget.value })} />
            </Group>
          </>
        )}
        <TextInput label="Intitulé du projet" required placeholder="Rénovation maison 1930" value={intitule} onChange={(e) => setIntitule(e.currentTarget.value)} />
        <Group grow>
          <Select label="Mission" data={(ref?.missions ?? []).filter((m) => !m.archive).map((m) => ({ value: m.code, label: m.libelle }))} value={missionCode} onChange={setMission} allowDeselect={false} required />
          <Select label="Origine" data={(ref?.origines ?? []).filter((o) => !o.archive).map((o) => ({ value: o.code, label: o.libelle }))} value={origineCode} onChange={setOrigine} required />
        </Group>
        <Select
          label="Apporteur"
          description="Facultatif : une commission d'apport (10 % des honoraires HT par défaut) lui sera due à la réception"
          searchable
          clearable
          data={apporteurs}
          value={apporteurId}
          onChange={setApporteur}
        />
        <TextInput label="Adresse du chantier" value={adresse} onChange={(e) => setAdresse(e.currentTarget.value)} />
        <ChampDate label="Prospect reçu le" value={recuLe} onChange={setRecuLe} required />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={enregistrer} disabled={!valide}>
            Créer le projet
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Nouvel échange (appel, rendez-vous, note…), avec relance facultative. */
export function ModalEchange({ opened, onClose, contactId, projetId }: { opened: boolean; onClose: () => void; contactId?: string; projetId?: string }) {
  const contacts = useOptionsContacts(["client", "entreprise", "apporteur", "partenaire", "autre"]);
  const { data: projets } = useQuery({ queryKey: ["projets", "options"], queryFn: () => listeProjets() });
  const [contact, setContact] = useState<string | null>(null);
  const [projet, setProjet] = useState<string | null>(null);
  const [nature, setNature] = useState<NatureInteraction>("appel");
  const [date, setDate] = useState<string | null>(aujourdhui());
  const [heure, setHeure] = useState("");
  const [objet, setObjet] = useState("");
  const [texte, setTexte] = useState("");
  const [aFaireLe, setAFaireLe] = useState<string | null>(null);
  useEffect(() => {
    if (!opened) return;
    const p = projets?.find((x) => x.id === projetId);
    setContact(contactId ?? p?.clientId ?? null);
    setProjet(projetId ?? null);
    setNature("appel");
    setDate(aujourdhui());
    setHeure("");
    setObjet("");
    setTexte("");
    setAFaireLe(null);
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const projetsDuContact = (projets ?? []).filter((p) => !contact || p.clientId === contact || p.id === projet);
  const enregistrer = async () => {
    const id = await ecrire(() => creerInteraction({ contactId: contact!, projetId: projet, nature, date: date!, heure, objet, texte, aFaireLe }));
    if (id) onClose();
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Nouvel échange" size="lg">
      <Stack>
        <Select label="Avec" searchable data={contacts} value={contact} onChange={setContact} required disabled={!!contactId} />
        <Select
          label="Projet"
          clearable
          searchable
          data={projetsDuContact.map((p) => ({ value: p.id, label: `${p.reference} · ${p.intitule}` }))}
          value={projet}
          onChange={setProjet}
          disabled={!!projetId}
        />
        <Select label="Nature" data={options(LIBELLES_NATURE)} value={nature} onChange={(n) => n && setNature(n as NatureInteraction)} allowDeselect={false} />
        <Group grow>
          <ChampDate label="Date" value={date} onChange={setDate} required />
          <TextInput label="Heure" type="time" value={heure} onChange={(e) => setHeure(e.currentTarget.value)} />
        </Group>
        <TextInput label="Objet" required placeholder="Rappel pour fixer la visite" value={objet} onChange={(e) => setObjet(e.currentTarget.value)} data-autofocus />
        <Textarea label="Compte rendu" autosize minRows={3} value={texte} onChange={(e) => setTexte(e.currentTarget.value)} />
        <ChampDate label="Relancer le" description="Facultatif : apparaîtra dans « À relancer » à cette date" value={aFaireLe} onChange={setAFaireLe} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={enregistrer} disabled={!contact || !date || !objet.trim()}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
