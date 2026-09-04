import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Database } from "@/db/client";

/**
 * Fresh in-memory Postgres (PGlite) with migrations applied, wired into the
 * global handle that `getDb()` returns. Call in `beforeEach`.
 */
export async function useTestDb(): Promise<Database> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Database;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  (globalThis as { __oraDb?: unknown }).__oraDb = db;
  (globalThis as { __oraPglite?: unknown }).__oraPglite = client;
  return db;
}

export function resetTestDb(): void {
  delete (globalThis as { __oraDb?: unknown }).__oraDb;
  delete (globalThis as { __oraPglite?: unknown }).__oraPglite;
}
