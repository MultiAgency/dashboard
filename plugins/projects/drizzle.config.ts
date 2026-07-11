import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.PROJECTS_DATABASE_URL || "pglite:.bos/projects/:memory:",
  },
  verbose: true,
  strict: true,
});
