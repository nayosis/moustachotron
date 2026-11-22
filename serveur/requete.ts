import type { Database, Statement } from "bun:sqlite";

/**
 * Exécute une requête préparée puis la libère aussitôt.
 *
 * Pas de `base.query()` sur une base qu'on doit pouvoir fermer : Bun garde ces requêtes dans un cache de taille
 * limitée, et une requête évincée du cache n'est pas libérée. Sous Bun 1.3 (celui de l'image Docker), la base
 * refuse alors de se fermer (« database is locked ») : la restauration d'une sauvegarde échouait, et les tests
 * aussi sur la CI.
 */
export function requete<T>(base: Database, sql: string, f: (q: Statement) => T): T {
  const q = base.prepare(sql);
  try {
    return f(q);
  } finally {
    q.finalize();
  }
}
