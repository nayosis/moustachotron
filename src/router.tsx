import { Outlet, createRootRoute, createRoute, createRouter, createBrowserHistory, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Layout } from "./components/Layout";
import { FournisseurSaisie } from "./lib/saisie";
import { SurOrdinateur } from "./components/SurOrdinateur";
import { Accueil } from "./pages/Accueil";
import { Contacts } from "./pages/Contacts";
import { FicheContact } from "./pages/FicheContact";
import { FicheProjet } from "./pages/FicheProjet";
import { Projets } from "./pages/Projets";
import { Tresorerie } from "./pages/Tresorerie";
import { Visite } from "./pages/Visite";
import { Parametres } from "./pages/Parametres";
import { Sauvegarde } from "./pages/Sauvegarde";
import { Connexion } from "./pages/compte/Connexion";
import { Lien } from "./pages/compte/Lien";
import { Comptes } from "./pages/compte/Comptes";
import { Journal } from "./pages/compte/Journal";
import { estAdmin, utilisateur } from "./lib/session";
import { useEcran } from "./lib/ecran";

/** Pages trop denses pour un téléphone : on y invite à passer sur ordinateur ou tablette. */
const surOrdinateur = (Page: () => ReactNode, titre: string) =>
  function PageSurOrdinateur() {
    return useEcran().telephone ? <SurOrdinateur titre={titre} /> : <Page />;
  };

const racine = createRootRoute({ component: Outlet });

/** Pages publiques : connexion, choix du mot de passe par lien. */
export const connexionRoute = createRoute({
  getParentRoute: () => racine,
  path: "/connexion",
  component: Connexion,
  validateSearch: (s: Record<string, unknown>): { retour?: string; email?: string } => ({
    ...(typeof s.retour === "string" ? { retour: s.retour } : {}),
    ...(typeof s.email === "string" ? { email: s.email } : {}),
  }),
});
export const lienRoute = createRoute({ getParentRoute: () => racine, path: "/lien/$jeton", component: Lien });

/** Tout le reste demande d'être connecté. */
const application = createRoute({
  getParentRoute: () => racine,
  id: "application",
  component: () => (
    <FournisseurSaisie>
      <Layout />
    </FournisseurSaisie>
  ),
  beforeLoad: ({ location }) => {
    if (!utilisateur()) throw redirect({ to: "/connexion", search: { retour: location.href } });
  },
});
const reserveAdmin = () => {
  if (!estAdmin()) throw redirect({ to: "/" });
};

export const accueilRoute = createRoute({ getParentRoute: () => application, path: "/", component: Accueil });
// --- Pages de l'application
export const projetsRoute = createRoute({
  getParentRoute: () => application,
  path: "/projets",
  component: Projets,
  // Filtres dans l'adresse : partageables, et conservés au retour arrière.
  validateSearch: (s: Record<string, unknown>): { q?: string; vue?: "liste"; issue?: "perdu" | "abandonne" | "tous" } => ({
    ...(typeof s.q === "string" && s.q ? { q: s.q } : {}),
    ...(s.vue === "liste" ? { vue: "liste" as const } : {}),
    ...(s.issue === "perdu" || s.issue === "abandonne" || s.issue === "tous" ? { issue: s.issue } : {}),
  }),
});
export const ficheProjetRoute = createRoute({ getParentRoute: () => application, path: "/projets/$id", component: FicheProjet });
const TYPES = ["client", "entreprise", "apporteur", "partenaire", "autre"] as const;
export const contactsRoute = createRoute({
  getParentRoute: () => application,
  path: "/contacts",
  component: Contacts,
  validateSearch: (s: Record<string, unknown>): { q?: string; type?: (typeof TYPES)[number] } => ({
    ...(typeof s.q === "string" && s.q ? { q: s.q } : {}),
    ...(TYPES.includes(s.type as (typeof TYPES)[number]) ? { type: s.type as (typeof TYPES)[number] } : {}),
  }),
});
const ONGLETS = ["synthese", "mouvements", "releve", "charges", "reglages"] as const;
export const tresorerieRoute = createRoute({
  getParentRoute: () => application,
  path: "/tresorerie",
  component: Tresorerie,
  validateSearch: (s: Record<string, unknown>): { onglet?: (typeof ONGLETS)[number] } => (ONGLETS.includes(s.onglet as (typeof ONGLETS)[number]) ? { onglet: s.onglet as (typeof ONGLETS)[number] } : {}),
});
export const ficheContactRoute = createRoute({ getParentRoute: () => application, path: "/contacts/$id", component: FicheContact });
export const visiteRoute = createRoute({ getParentRoute: () => application, path: "/visites/$id", component: Visite });
const parametres = createRoute({ getParentRoute: () => application, path: "/parametres", component: surOrdinateur(Parametres, "Paramètres") });

// --- Pages du socle (admins, sur ordinateur)
const sauvegarde = createRoute({ getParentRoute: () => application, path: "/sauvegarde", component: surOrdinateur(Sauvegarde, "Sauvegarde"), beforeLoad: reserveAdmin });
const comptes = createRoute({ getParentRoute: () => application, path: "/comptes", component: surOrdinateur(Comptes, "Comptes"), beforeLoad: reserveAdmin });
const journal = createRoute({ getParentRoute: () => application, path: "/journal", component: surOrdinateur(Journal, "Journal"), beforeLoad: reserveAdmin });

export const router = createRouter({
  routeTree: racine.addChildren([connexionRoute, lienRoute, application.addChildren([accueilRoute, projetsRoute, ficheProjetRoute, contactsRoute, ficheContactRoute, tresorerieRoute, visiteRoute, parametres, sauvegarde, comptes, journal])]),
  history: createBrowserHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
