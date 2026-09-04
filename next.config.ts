import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    "xrpl",
    "pino",
    "pino-pretty",
    "@electric-sql/pglite",
    "drizzle-orm",
  ],
  // Home dir has an unrelated package-lock.json; pin the workspace root here.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
