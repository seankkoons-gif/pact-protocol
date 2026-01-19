import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@pact/sdk": resolve(__dirname, "../sdk/src/index.ts"),
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


