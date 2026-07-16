import { getDb, seedDefaultsIfNeeded } from "./db";
import { SEED_DEFAULT_LABELS } from "./config";

/**
 * Get the app DB, running first-run seeding if enabled and needed. UI server
 * components / actions call this instead of `getDb` directly so the "fresh DB
 * gets default labels" behavior is centralized.
 */
export function getServerDb() {
  const db = getDb();
  if (SEED_DEFAULT_LABELS) {
    seedDefaultsIfNeeded(db);
  }
  return db;
}
