import nextConfig from "eslint-config-next";
import tseslint from "typescript-eslint";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "hook/**",
      "skills/**",
      "drizzle/**",
      "next-env.d.ts",
    ],
  },
  ...nextConfig,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["scripts/**/*.ts", "tests/**/*.ts", "**/*.test.ts"],
    rules: {
      "no-console": "off",
    },
  },
];

export default config;
