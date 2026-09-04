import { defineConfig } from "drizzle-kit";

// Load local env for CLI usage (Next handles this itself at runtime).
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // file absent — fine
  }
}

const url = process.env.DATABASE_URL;
const usePg = !!url && /^postgres(ql)?:\/\//.test(url);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(usePg
    ? { dbCredentials: { url: url! } }
    : {
        driver: "pglite",
        dbCredentials: { url: process.env.PGLITE_DATA_DIR ?? "./.pglite" },
      }),
  strict: true,
  verbose: true,
});
