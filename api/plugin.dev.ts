import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import type { PluginConfigInput } from "every-plugin";
import packageJson from "./package.json" with { type: "json" };
import type Plugin from "./src/index";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env") });

export default {
  pluginId: packageJson.name,
  port: Number(process.env.PORT) || 3001,
  config: {
    variables: {},
    secrets: {
      API_DATABASE_URL: process.env.API_DATABASE_URL || "pglite:memory://",
    },
  } satisfies PluginConfigInput<typeof Plugin>,
};
