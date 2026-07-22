import { eq } from "drizzle-orm";
import { getDb, seedDefaultsIfNeeded, getDefaultProject } from "./db";
import * as schema from "./db/schema";
import type { DB } from "./db";
import type { ProjectRow } from "./db/schema";
import { SEED_DEFAULT_LABELS } from "./config";

/**
 * Get the app DB, running first-run seeding if enabled and needed. UI server
 * components / actions call this instead of `getDb` directly so the "fresh DB
 * gets default labels" behavior is centralized.
 */
export function getServerDb(): DB {
  const db = getDb();
  if (SEED_DEFAULT_LABELS) {
    seedDefaultsIfNeeded(db);
  }
  return db;
}

/**
 * Resolve the active project for a server component / action. Mirrors the API's
 * `requireProject` helper: an explicit `key` overrides; absent key falls back
 * to the default project (first by id). Returns null only when an explicit key
 * is given but no project matches.
 */
export function getServerProject(
  db: DB,
  key: string | null | undefined,
): ProjectRow | null {
  const trimmed = key?.trim();
  if (trimmed && trimmed.length > 0) {
    return (
      db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.key, trimmed.toUpperCase()))
        .get() ?? null
    );
  }
  return getDefaultProject(db);
}
