/** Libellés affichés des valeurs codées (types de contact, natures d'échange, issues…). */

export const LIBELLES_TYPE_CONTACT: Record<string, string> = {
  client: "Client",
  entreprise: "Entreprise",
  apporteur: "Apporteur",
  partenaire: "Partenaire",
  autre: "Autre",
};

export const LIBELLES_NATURE: Record<string, string> = {
  appel: "Appel",
  email: "E-mail",
  rdv: "Rendez-vous",
  visite: "Visite",
  sms: "SMS",
  note: "Note",
};

export const LIBELLES_ISSUE: Record<string, string> = { en_cours: "En cours", perdu: "Perdu", abandonne: "Abandonné" };

export const LIBELLES_STATUT_DEVIS: Record<string, string> = { recu: "Reçu", retenu: "Retenu", refuse: "Refusé" };

export const COULEUR_STATUT_DEVIS: Record<string, string> = { recu: "gray", retenu: "green", refuse: "red" };

/** Options d'un Select à partir d'un dictionnaire de libellés. */
export const options = (l: Record<string, string>) => Object.entries(l).map(([value, label]) => ({ value, label }));
