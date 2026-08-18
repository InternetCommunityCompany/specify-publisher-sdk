import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { removeSync } from "fs-extra/esm";

// Ensure a clean state for the new build output
removeSync(resolve(process.cwd(), "dist"));

// First, generate TypeScript declarations.
// `@specify-sh/core` resolves to its pre-built declarations, so the root build
// script emits those before this package is built.
console.log("Generating TypeScript declarations...");
execSync("bun run tsc -p tsconfig.build.json --emitDeclarationOnly", { stdio: "inherit" });

// Then build the ESM package entry. `@specify-sh/core` is a private workspace
// package and is inlined here rather than left as an external import.
console.log("Building ESM bundle...");
await Bun.build({
  entrypoints: ["./lib/index.ts"],
  outdir: "./dist",
  sourcemap: "external", // separate .map files instead of inlining
  target: "browser",
  format: "esm",
  splitting: true,
  minify: true,
  env: "disable",
  drop: ["debugger"], // remove debugger statements
  footer: `
      /* Built with ❤️ by Specify team */
    `,
});

// Then the GTM/CDN loader: one self-contained IIFE, no module syntax, no
// chunks. Copied into the edge repo and served at
// https://spfsrv.com/sdk/advertiser/v1.js
console.log("Building GTM loader...");
await Bun.build({
  entrypoints: ["./lib/gtm/loader.ts"],
  outdir: "./dist/loader",
  naming: "v1.[ext]",
  target: "browser",
  format: "iife",
  splitting: false,
  sourcemap: "none",
  minify: true,
  env: "disable",
  drop: ["debugger"],
});

console.log("✅ Build completed successfully");
