import { defineConfig } from "drizzle-kit";

// Load local env for CLI usage (Next handles this itself at runtime).
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // file absent — fine
  }
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://ora:ora@localhost:5432/ora",
  },
  strict: true,
  verbose: true,
});
