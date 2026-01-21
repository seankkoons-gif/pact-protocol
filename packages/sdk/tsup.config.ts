import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  tsconfig: "tsconfig.build.json",
  // Bundle zod and other dependencies (except peer deps)
  // This ensures the SDK works without requiring dependencies to be installed in consuming projects
  noExternal: ["zod", "bs58", "ajv", "ajv-formats", "minimist"],
  // Externalize peer dependencies (they should be provided by the consumer)
  // Externalize tweetnacl - it has dynamic requires that break when bundled into ESM
  external: ["@pact/passport", "tweetnacl"],
  // Ensure JSON imports are handled
  loader: {
    ".json": "json",
  },
});

