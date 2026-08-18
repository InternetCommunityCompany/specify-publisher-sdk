/**
 * The `npx @specify-sh/wizard` entry point.
 *
 * Deliberately thin: parse, wire the real dependencies, run, exit. Everything
 * worth testing lives in the modules it imports.
 */

import { pathToFileURL } from "node:url";
import { createAnyAgentGateway } from "./agent";
import { USAGE, parseWizardArgs } from "./args";
import { clackIo } from "./io";
import { EXIT_FAILED, runWizard } from "./orchestrator";

/**
 * Parse argv, run the wizard and resolve with a process exit code.
 *
 * @param argv - Arguments after the node binary and script path
 * @returns The exit code
 */
export async function main(argv: string[]): Promise<number> {
  const parsed = parseWizardArgs(argv, process.cwd());

  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n\n${USAGE}`);
    return EXIT_FAILED;
  }

  if (parsed.args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const io = clackIo();

  try {
    return await runWizard(parsed.args, { gateway: createAnyAgentGateway(), io });
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return EXIT_FAILED;
  }
}

// Run only when this file is the process entry point, so importing `main` from
// a test does not launch a wizard.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
