import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { removeSync } from "fs-extra/esm";

// Ensure a clean state for the new build output
removeSync(resolve(process.cwd(), "dist"));

// First, generate TypeScript declarations
console.log("Generating TypeScript declarations...");
execSync("bun run tsc --emitDeclarationOnly", { stdio: "inherit" });

// Then build with Bun
console.log("Building with Bun...");
await Bun.build({
  entrypoints: ["./lib/index.ts"],
  outdir: "./dist",
  sourcemap: "external", // separate .map files instead of inlining
  target: "browser", // Changed from "node" to "browser"
  format: "esm", // to use ES Module syntax in browsers, set format to "esm" and make sure your <script type="module"> tag has type="module" set.
  splitting: true,
  minify: true,
  env: "disable",
  drop: ["debugger"], // remove debugger statements
  footer: `
      /* Built with ❤️ by Specify team */
    `,
});

console.log("✅ Build completed successfully");
