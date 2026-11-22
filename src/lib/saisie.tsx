import { createContext, useContext, useState, type ReactNode } from "react";
import { ModalEchange, ModalProjet } from "../components/Formulaires";

/**
 * Saisie rapide, ouverte de n'importe où (bouton « + » du téléphone, accueil, listes) : un nouveau projet
 * (prospect qui appelle) ou un nouvel échange (appel, rendez-vous, relance).
 */
type Saisies = { nouveauProjet: () => void; nouvelEchange: () => void };
const Saisie = createContext<Saisies>({ nouveauProjet: () => {}, nouvelEchange: () => {} });
export const useSaisie = () => useContext(Saisie);

export function FournisseurSaisie({ children }: { children: ReactNode }) {
  const [projet, setProjet] = useState(false);
  const [echange, setEchange] = useState(false);
  return (
    <Saisie.Provider value={{ nouveauProjet: () => setProjet(true), nouvelEchange: () => setEchange(true) }}>
      {children}
      <ModalProjet opened={projet} onClose={() => setProjet(false)} />
      <ModalEchange opened={echange} onClose={() => setEchange(false)} />
    </Saisie.Provider>
  );
}
