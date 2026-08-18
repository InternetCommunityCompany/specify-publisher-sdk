import { execSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { resolve } from "node:path";
import { removeSync } from "fs-extra/esm";

// Ensure a clean state for the new build output
removeSync(resolve(process.cwd(), "dist"));

// First, generate TypeScript declarations. Unlike the SDKs this package has no
// workspace dependencies, so nothing has to be built before it.
console.log("Generating TypeScript declarations...");
execSync("bun run tsc -p tsconfig.build.json --emitDeclarationOnly", { stdio: "inherit" });

// Then the CLI itself. Target is `node`, not `browser` — this is the one
// package here that never runs in a page. `anyagent-js` and `@clack/prompts`
// are real runtime dependencies declared in package.json, so they stay
// external and are resolved from node_modules at run time.
console.log("Building CLI bundle...");
await Bun.build({
  banner: "#!/usr/bin/env node",
  drop: ["debugger"],
  entrypoints: ["./lib/cli.ts"],
  env: "disable",
  external: ["anyagent-js", "@clack/prompts"],
  format: "esm",
  minify: false, // a CLI stack trace should be readable
  outdir: "./dist",
  sourcemap: "external",
  splitting: false,
  target: "node",
});

// npx runs the bin directly, so it has to be executable.
chmodSync(resolve(process.cwd(), "dist/cli.js"), 0o755);

console.log("✅ Build completed successfully");
