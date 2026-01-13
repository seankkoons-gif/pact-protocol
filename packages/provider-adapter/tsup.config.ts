import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts", "src/server.ts"],
  format: ["esm"],
  dts: {
    resolve: true,
  },
  clean: true,
  target: "es2022",
  tsconfig: "tsconfig.build.json",
  banner: {
    js: "#!/usr/bin/env node\n",
  },
  external: ["@pact/sdk"],
});
