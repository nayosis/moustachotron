# Le Moustachotron

Outil de gestion d'un maître d'œuvre indépendant franchisé : **trésorerie prévisionnelle**, **prospects et projets**
(avant-vente, devis par lot, signature), **suivi de chantier** (visites, comptes rendus, photos), utilisable sur
téléphone **hors ligne**. Construit sur le socle Fundamentum (comptes, journal de preuve, sauvegardes, Docker).

## À lire avant de travailler

- `docs/conception.md` : le besoin et **toutes les décisions** fonctionnelles. Elle fait foi : si une demande la
  contredit, le signaler et proposer de la mettre à jour d'abord. Les « À décider » renvoient à
  `docs/questions-cadrage.md`.
- `docs/architecture-hors-ligne.md` : la dérogation au socle (hors ligne) et son fonctionnement.
- `docs/analyse-tableurs.md` : ce que faisaient les tableurs Excel qu'on remplace.
- `docs/rapport-de-visite.md` : structure du compte rendu de chantier (PDF) à reproduire.
- `docs/deploiement-raitchu.md` : installation sur le serveur Raitchu (Dockge, clé de déploiement, HTTPS) ; fichiers de
  la pile dans `docker/dockge/`.
- Skills du projet (`.claude/skills/`) :
  - `cadrage` : discuter et remplir / faire évoluer la conception ;
  - `architecture` : principes du socle (RPC, journal, droits, fichiers, sauvegardes, notifications) ;
  - `socle-technique` : pile, conventions, recettes ;
  - `metier-moe` : vocabulaire et cycle métier (missions, honoraires, commissions, lots, statuts) ;
  - `tresorerie` : calculs, prévisionnel, horizons, import ;
  - `hors-ligne` : rendre une fonctionnalité utilisable sans réseau.
- Dépôt modèle du socle : https://github.com/nayosis/fundamentum — référence complète :
  https://github.com/nayosis/cura-parentum. **Téléphone (PWA, push, iCal) : faire comme
  https://github.com/nayosis/custos-domus** (`public/sw.js`, `src/lib/push.ts`), plus la couche hors ligne.
- Livrable : une **image Docker** (instance personnelle, VPS à terme), toujours derrière HTTPS.

## Règles de travail

- Tout en **français** : code, commentaires, messages, commits, CHANGELOG.
- Le métier tient dans `src/data/`, `src/db/schema.ts`, `src/pages/`, `src/components/`, et deux fichiers de
  liaison : `serveur/modele.ts` et `src/lib/modele.ts`. Les ajouts hors ligne au socle (`rpcTerrain`, `sw.js`,
  `ECRITURES_TERRAIN`) sont génériques : les signaler pour report dans le dépôt modèle.
- **Données réelles** : les tableurs du client sont dans `docs/sources/` (ignorés par git). Ne jamais copier un nom
  de client réel dans le code, les tests, les maquettes, les commits ou un service externe.
- Montants en centimes, taux en points de base, dates ISO, UUID générés sur l'appareil.
- `src/data/` n'exporte **que des fonctions et des types** : dans le navigateur, chaque export devient un appel au
  serveur. Une constante partagée (listes, taux) va dans `src/lib/`.
- Avant de dire qu'une tâche est finie : `bun run type-check && bun test`.
- Une règle métier nouvelle → elle s'écrit dans `docs/conception.md` **et** elle a un test.
- Pas de nouvelle dépendance, pas de push, pas d'étiquette de version sans accord.
- Réponses courtes ; proposer une option recommandée plutôt qu'une liste de possibilités.

## Commandes

```bash
bun install
bun run dev          # interface http://localhost:5183, API :3220
bun run dev:reseau   # idem, ouverte au réseau local (essai sur téléphone : http://<ip-du-pc>:5183)
bun test
bun run type-check
bun run db:generate  # après modification de src/db/schema.ts
bun scripts/importer-tableurs.ts "docs/sources/Tableau de gestion.xlsx"   # reprise : essai (ajouter --ecrire, serveur arrêté)
bun scripts/reprendre-chantiers.ts "docs/sources/Chantiers Année 3.xlsx" "docs/sources/Tableau de gestion.xlsx"   # essai (--ecrire : par l'API)
bun scripts/charges-depuis-synthese.ts "docs/sources/Tableau de gestion.xlsx" "Synthèse Année 3" 2026-12 --json charges.json
```

## État

**Phases 1 (Contacts & Projets), 2 (Trésorerie) et 3a (visites et rapport PDF) livrées en développement le
22/11/2026, version 0.4.0** — 88 tests verts. Base locale : tableurs repris (1 284 mouvements), 32 charges récurrentes, 14 chantiers en cours.
Prochaine étape : **phase 3b** (hors ligne terrain : skill `hors-ligne`, `docs/architecture-hors-ligne.md`).
Dépôt privé : https://github.com/nayosis/moustachotron (image `ghcr.io/nayosis/moustachotron`), en ligne sur
https://moustachotron.gouadon.fr. Déploiement sur le
serveur Raitchu : `docs/deploiement-raitchu.md`. Améliorations du socle à reporter : `docs/ameliorations-socle.md`.
