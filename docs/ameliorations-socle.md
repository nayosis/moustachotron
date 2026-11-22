# Améliorations du socle à reporter dans Fundamentum

Faites dans Le Moustachotron hors du métier ; génériques, elles profiteraient au dépôt modèle
(https://github.com/nayosis/fundamentum) et aux autres applications.

| Date | Fichier | Amélioration | Pourquoi |
|---|---|---|---|
| 22/11/2026 | `serveur/dev.ts` | Lancer `process.execPath` et `bun x vite` au lieu de `bun` / `bunx` | Sur Windows (Bun installé par winget), `bunx` n'existe pas : `bun run dev` échouait au démarrage. |
| 22/11/2026 | `serveur/app.ts`, `src/lib/documents.ts` | Word et Excel acceptés à l'envoi (`docx`, `doc`, `xlsx`, `xls`) | Besoin courant (devis, descriptifs) ; à rendre réglable par application plutôt que codé en dur. |
| 22/11/2026 | `serveur/journal.ts` (`instantane`) | Le journal suppose une clé `id` sur toute table de `TABLES_SUIVIES` ; une table à clé `code` fait échouer l'instantané | À documenter dans le skill `architecture`, ou rendre `instantane` tolérant (ignorer les tables sans colonne `id`). |
| 22/11/2026 | `CLAUDE.md` (règle) | `src/data/` n'exporte que des fonctions et des types | Dans le navigateur, chaque export devient un talon RPC : une constante exportée y devient une fonction (`x.map is not a function`). À ajouter au skill `socle-technique`. |
| 22/11/2026 | `scripts/renommer.ts` | Ne pas renommer « socle Fundamentum » dans `CLAUDE.md` | La ligne « Construit sur le socle Fundamentum » ne contient pas le mot « modèle » et a été renommée à tort. |
| À venir (phase 3) | `src/lib/rpc.ts`, `public/sw.js`, `serveur/rpc.ts` | File d'envoi hors ligne, idempotence, `saisiLe` | Cf. `docs/architecture-hors-ligne.md`. |
