import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Use fileURLToPath for ESM compatibility when running from workspace root
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");

export default defineConfig({
  resolve: {
    alias: {
      "@pact/provider-adapter": resolve(__dirname, "../provider-adapter/src/index.ts"),
      "@pact/sdk": resolve(__dirname, "src/index.ts"),
      "@pact/passport": resolve(__dirname, "../passport/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist", ".git"],
    // prevents weird worker fetch behavior in some setups
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: true,
      },
    },
    hookTimeout: 60_000,
    testTimeout: 60_000,
    teardownTimeout: 10_000,
  },
});
