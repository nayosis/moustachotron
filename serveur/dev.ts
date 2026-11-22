/** Développement : serveur (API, port 3220) et Vite (interface, port 5183) ensemble. */
import { join } from "node:path";

const racine = join(import.meta.dir, "..");
// Le port de l'API est fixé ici : la variable PORT de l'environnement vise Vite.
// L'exécutable de Bun en cours (process.execPath) et « bun x » plutôt que « bunx » : l'installation Windows
// (winget) ne fournit pas toujours bunx ni bun dans le PATH des processus lancés.
const serveur = Bun.spawn([process.execPath, "--watch", "serveur/index.ts"], {
  cwd: racine,
  env: { ...process.env, PORT: "3220" },
  stdout: "inherit",
  stderr: "inherit",
});
// « --reseau » (bun run dev:reseau) : interface ouverte aux autres appareils du réseau local (essai sur téléphone).
const reseau = process.argv.includes("--reseau") ? ["--host"] : [];
const client = Bun.spawn([process.execPath, "x", "vite", ...reseau], { cwd: racine, stdout: "inherit", stderr: "inherit" });
const arreter = () => {
  serveur.kill();
  client.kill();
  process.exit(0);
};
process.on("SIGINT", arreter);
process.on("SIGTERM", arreter);
await Promise.race([serveur.exited, client.exited]);
arreter();
