import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { env, dbDriver } from "@/env";
import * as schema from "./schema";

/**
 * Both dev (PGlite) and prod (node-postgres) drivers expose the identical
 * Drizzle query API, so we surface one type. PGlite keeps local dev zero-infra;
 * set a `postgres://` DATABASE_URL to use real Postgres.
 */
export type Database = NodePgDatabase<typeof schema>;

declare global {
  var __oraDb: Database | undefined;
  var __oraPglite: unknown | undefined;
}

async function create(): Promise<Database> {
  if (dbDriver === "pg") {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: env.DATABASE_URL, max: 8 });
    return drizzle(pool, { schema });
  }
  const { drizzle } = await import("drizzle-orm/pglite");
  const { PGlite } = await import("@electric-sql/pglite");
  const client =
    (globalThis.__oraPglite as InstanceType<typeof PGlite> | undefined) ??
    new PGlite(env.PGLITE_DATA_DIR);
  globalThis.__oraPglite = client;
  return drizzle(client, { schema }) as unknown as Database;
}

/** Lazily-created, hot-reload-safe database handle. `await getDb()` in server code. */
export async function getDb(): Promise<Database> {
  if (!globalThis.__oraDb) {
    globalThis.__oraDb = await create();
  }
  return globalThis.__oraDb;
}

export { schema };
