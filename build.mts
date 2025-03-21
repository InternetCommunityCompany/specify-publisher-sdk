import { removeSync } from "fs-extra/esm";
import { resolve } from "node:path";

// Ensure a clean state for the new build output
removeSync(resolve(process.cwd(), "dist"));

await Bun.build({
    entrypoints: ["./lib/index.ts"],
    outdir: "./dist",
    sourcemap: "external", // separate .map files instead of inlining
    target: "node", // we prioritize node compatibility over browser compatibility
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
