import { describe, expect, it } from "bun:test";
import type { AgentGateway, AgentOption, AgentRunner, WizardRun, WizardRunOptions } from "../lib/agent";
import type { WizardArgs } from "../lib/args";
import { CANCELLED, type SelectChoice, type WizardIo, type WizardSpinner } from "../lib/io";
import { placeholderKey } from "../lib/keys";
import { EXIT_CANCELLED, EXIT_FAILED, EXIT_OK, type WizardDeps, runWizard } from "../lib/orchestrator";
import type { ProductId } from "../lib/products";
import type { VerificationResult } from "../lib/verify";
import { RECON_FIXTURE, VALID_PUBLISHER_KEY } from "./fixtures";

type Answer = boolean | string | typeof CANCELLED;

interface Printed {
  kind: "cancel" | "error" | "info" | "intro" | "note" | "outro" | "plain" | "success" | "warn";
  text: string;
}

/**
 * A `WizardIo` that answers from a fixed script and records everything printed,
 * so the orchestrator's whole decision tree runs with no terminal attached.
 */
class ScriptedIo implements WizardIo {
  readonly printed: Printed[] = [];
  readonly asked: string[] = [];
  private readonly answers: Answer[];

  constructor(answers: Answer[] = []) {
    this.answers = [...answers];
  }

  /** Everything printed, joined — for coarse "did it mention X" assertions. */
  get output(): string {
    return this.printed.map((entry) => entry.text).join("\n");
  }

  private next(prompt: string): Answer {
    this.asked.push(prompt);
    if (this.answers.length === 0) {
      throw new Error(`ScriptedIo ran out of answers at: ${prompt}`);
    }
    return this.answers.shift() as Answer;
  }

  cancel(message: string): void {
    this.printed.push({ kind: "cancel", text: message });
  }

  async confirm(message: string): Promise<boolean | typeof CANCELLED> {
    const answer = this.next(message);
    return answer === CANCELLED ? CANCELLED : answer === true;
  }

  error(message: string): void {
    this.printed.push({ kind: "error", text: message });
  }

  info(message: string): void {
    this.printed.push({ kind: "info", text: message });
  }

  intro(message: string): void {
    this.printed.push({ kind: "intro", text: message });
  }

  note(body: string, title?: string): void {
    this.printed.push({ kind: "note", text: title ? `${title}\n${body}` : body });
  }

  outro(message: string): void {
    this.printed.push({ kind: "outro", text: message });
  }

  plain(body: string): void {
    this.printed.push({ kind: "plain", text: body });
  }

  async select(message: string, _choices: SelectChoice[]): Promise<string | typeof CANCELLED> {
    const answer = this.next(message);
    return answer === CANCELLED ? CANCELLED : String(answer);
  }

  spinner(): WizardSpinner {
    return { message: () => undefined, start: () => undefined, stop: () => undefined };
  }

  success(message: string): void {
    this.printed.push({ kind: "success", text: message });
  }

  async text(options: { message: string }): Promise<string | typeof CANCELLED> {
    const answer = this.next(options.message);
    return answer === CANCELLED ? CANCELLED : String(answer);
  }

  warn(message: string): void {
    this.printed.push({ kind: "warn", text: message });
  }
}

interface RecordedRun {
  options: WizardRunOptions;
  prompt: string;
}

/** A gateway over fake runners that record their prompts instead of running. */
function fakeGateway(options: {
  agents?: Partial<AgentOption>[];
  failOn?: (prompt: string) => Error | undefined;
  json?: unknown;
  runs?: RecordedRun[];
  text?: string;
}): AgentGateway {
  const runs = options.runs ?? [];
  const agents: AgentOption[] = (options.agents ?? [{}]).map((agent, index) => ({
    canReadOnly: true,
    canSchema: true,
    id: `agent-${index}`,
    name: `Agent ${index}`,
    version: "1.0.0",
    ...agent,
  }));

  return {
    async list(): Promise<AgentOption[]> {
      return agents;
    },
    async open(id: string): Promise<AgentRunner> {
      const agent = agents.find((candidate) => candidate.id === id);
      if (!agent) {
        throw new Error(`no such agent: ${id}`);
      }
      return {
        ...agent,
        run(prompt: string, runOptions: WizardRunOptions): WizardRun {
          runs.push({ options: runOptions, prompt });
          const failure = options.failOn?.(prompt);
          const done = failure
            ? Promise.reject(failure)
            : Promise.resolve({ json: options.json, text: options.text ?? "" });
          done.catch(() => undefined);
          return {
            done,
            events: (async function* () {
              yield { kind: "modify", path: "app/layout.tsx", type: "file-change" };
            })(),
          };
        },
      };
    },
  };
}

function args(overrides: Partial<WizardArgs> = {}): WizardArgs {
  return { dir: "/srv/app", dryRun: false, help: false, yes: false, ...overrides };
}

function verification(complete: boolean): VerificationResult {
  return {
    complete,
    dependencyDeclared: complete,
    markers: [
      { files: complete ? ["src/a.ts"] : [], found: complete, hint: "wire it", label: "serve", required: true },
    ],
  };
}

function deps(overrides: Partial<WizardDeps> & { gateway: AgentGateway; io: WizardIo }): WizardDeps {
  return {
    readDiffStat: async () => " src/a.ts | 12 ++++",
    readGitStatus: async () => ({ dirty: false, dirtyFiles: [], isRepo: true }),
    verify: async () => verification(true),
    ...overrides,
  };
}

describe("runWizard — the no-agent fallback", () => {
  it("prints the full manual integration and exits successfully", async () => {
    const io = new ScriptedIo();
    const gateway = fakeGateway({ agents: [] });

    const code = await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(code).toBe(EXIT_OK);
    expect(io.output).toContain("No supported coding agent was found");
    expect(io.output).toContain("npm install @specify-sh/sdk");
    expect(io.output).toContain("https://spfsrv.com/sdk/v1.js");
    expect(io.output).toContain("consentForEnhancedTracking");
  });

  it("uses the manual instructions for whichever product was chosen", async () => {
    const io = new ScriptedIo();
    const code = await runWizard(
      args({ product: "advertiser", yes: true }),
      deps({ gateway: fakeGateway({ agents: [] }), io }),
    );

    expect(code).toBe(EXIT_OK);
    expect(io.output).toContain("@specify-sh/advertiser");
    expect(io.output).toContain("https://spfsrv.com/sdk/advertiser/v1.js");
  });

  it("never asks about the working tree, because it changes nothing", async () => {
    const io = new ScriptedIo();
    await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher" }),
      deps({
        gateway: fakeGateway({ agents: [] }),
        io,
        readGitStatus: async () => ({ dirty: true, dirtyFiles: ["a.ts"], isRepo: true }),
      }),
    );
    expect(io.asked).toEqual([]);
  });
});

describe("runWizard — the two-pass flow", () => {
  it("runs recon read-only with a schema, then implementation without", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo();
    const gateway = fakeGateway({ json: RECON_FIXTURE, runs, text: "Added the provider." });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io }),
    );

    expect(code).toBe(EXIT_OK);
    expect(runs).toHaveLength(2);

    expect(runs[0].options.readOnly).toBe(true);
    expect(runs[0].options.schema).toBeDefined();
    expect(runs[0].options.cwd).toBe("/srv/app");
    expect(runs[0].prompt).toContain("READ-ONLY");

    expect(runs[1].options.readOnly).toBeUndefined();
    expect(runs[1].options.schema).toBeUndefined();
    expect(runs[1].prompt).toContain(VALID_PUBLISHER_KEY);
    expect(runs[1].prompt).toContain("Cookiebot");
    expect(runs[1].prompt).toContain("NEVER hardcode consent as granted");
  });

  it("shows the plan and the agent's own summary", async () => {
    const io = new ScriptedIo();
    const gateway = fakeGateway({ json: RECON_FIXTURE, text: "Added the provider." });

    await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }), deps({ gateway, io }));

    expect(io.output).toContain("next (app-router)");
    expect(io.output).toContain("Added the provider.");
    expect(io.output).toContain("Review the diff before you commit");
    expect(io.output).toContain("https://docs.specify.sh/publishing/sdk-reference");
  });

  it("asks to confirm the plan and stops when the answer is no", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo([false]);
    const gateway = fakeGateway({ json: RECON_FIXTURE, runs });

    const code = await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(code).toBe(EXIT_CANCELLED);
    expect(runs).toHaveLength(1);
    expect(io.asked.at(-1)).toContain("Apply this plan?");
  });

  it("falls back to one combined pass when the agent cannot investigate read-only", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo();
    const gateway = fakeGateway({ agents: [{ canReadOnly: false }], runs });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io }),
    );

    expect(code).toBe(EXIT_OK);
    expect(runs).toHaveLength(1);
    expect(runs[0].options.readOnly).toBeUndefined();
    expect(runs[0].prompt).toContain("Investigate before you edit");
    expect(io.output).toContain("single pass");
  });

  it("falls back the same way when the agent cannot return structured output", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo();
    const gateway = fakeGateway({ agents: [{ canSchema: false }], runs });

    await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }), deps({ gateway, io }));

    expect(runs).toHaveLength(1);
    expect(runs[0].prompt).toContain("Investigate before you edit");
  });

  it("carries on with a combined pass when the recon run itself fails", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo();
    const gateway = fakeGateway({
      failOn: (prompt) => (prompt.includes("READ-ONLY") ? new Error("recon exploded") : undefined),
      runs,
    });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io }),
    );

    expect(code).toBe(EXIT_OK);
    expect(runs).toHaveLength(2);
    expect(runs[1].prompt).toContain("Investigate before you edit");
    expect(io.output).toContain("recon exploded");
  });
});

describe("runWizard — dry run", () => {
  it("shows the plan and never runs an implementation pass", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo();
    const gateway = fakeGateway({ json: RECON_FIXTURE, runs });

    const code = await runWizard(
      args({ dryRun: true, key: VALID_PUBLISHER_KEY, product: "publisher" }),
      deps({ gateway, io }),
    );

    expect(code).toBe(EXIT_OK);
    expect(runs).toHaveLength(1);
    expect(runs[0].options.readOnly).toBe(true);
    expect(io.output).toContain("Dry run — nothing was changed");
    expect(io.asked).toEqual([]);
  });

  it("says there is no plan when the agent cannot investigate read-only", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo();
    const gateway = fakeGateway({ agents: [{ canReadOnly: false }], runs });

    const code = await runWizard(
      args({ dryRun: true, key: VALID_PUBLISHER_KEY, product: "publisher" }),
      deps({ gateway, io }),
    );

    expect(code).toBe(EXIT_OK);
    expect(runs).toHaveLength(0);
    expect(io.output).toContain("no plan to show");
  });
});

describe("runWizard — the working-tree guardrail", () => {
  it("warns and asks before editing a dirty tree", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo([true, true]);
    const gateway = fakeGateway({ json: RECON_FIXTURE, runs });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher" }),
      deps({
        gateway,
        io,
        readGitStatus: async () => ({ dirty: true, dirtyFiles: ["a.ts", "b.ts"], isRepo: true }),
      }),
    );

    expect(code).toBe(EXIT_OK);
    expect(io.output).toContain("uncommitted changes");
    expect(io.asked[0]).toContain("Continue anyway?");
  });

  it("stops when the answer is no", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo([false]);
    const gateway = fakeGateway({ runs });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher" }),
      deps({
        gateway,
        io,
        readGitStatus: async () => ({ dirty: true, dirtyFiles: ["a.ts"], isRepo: true }),
      }),
    );

    expect(code).toBe(EXIT_CANCELLED);
    expect(runs).toHaveLength(0);
  });

  it("warns when the target is not a git repository at all", async () => {
    const io = new ScriptedIo([true, true]);
    const gateway = fakeGateway({ json: RECON_FIXTURE });

    await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher" }),
      deps({
        gateway,
        io,
        readDiffStat: async () => null,
        readGitStatus: async () => ({ dirty: false, dirtyFiles: [], isRepo: false }),
      }),
    );

    expect(io.output).toContain("not a git repository");
  });

  it("does not ask on a clean tree", async () => {
    const io = new ScriptedIo([true]);
    const gateway = fakeGateway({ json: RECON_FIXTURE });

    await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(io.asked).toHaveLength(1);
    expect(io.asked[0]).toContain("Apply this plan?");
  });

  it("skips the question under --yes but still warns", async () => {
    const io = new ScriptedIo();
    const gateway = fakeGateway({ json: RECON_FIXTURE });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({
        gateway,
        io,
        readGitStatus: async () => ({ dirty: true, dirtyFiles: ["a.ts"], isRepo: true }),
      }),
    );

    expect(code).toBe(EXIT_OK);
    expect(io.output).toContain("uncommitted changes");
  });
});

describe("runWizard — product and key", () => {
  it("asks for the product when no flag was given", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo(["advertiser", VALID_PUBLISHER_KEY.replace("spk_", "adv_"), true, true]);
    const gateway = fakeGateway({ json: RECON_FIXTURE, runs });

    const code = await runWizard(args(), deps({ gateway, io }));

    expect(code).toBe(EXIT_OK);
    expect(io.asked[0]).toContain("Which Specify SDK");
    expect(runs[1].prompt).toContain("@specify-sh/advertiser");
  });

  it("rejects an invalid --key before touching anything", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo();
    const gateway = fakeGateway({ runs });

    const code = await runWizard(args({ key: "spk_nope", product: "publisher" }), deps({ gateway, io }));

    expect(code).toBe(EXIT_FAILED);
    expect(runs).toHaveLength(0);
    expect(io.output).toContain("not a valid publisher key");
  });

  it("rejects the other product's key", async () => {
    const io = new ScriptedIo();
    const code = await runWizard(
      args({ key: "adv_1234567890abcdef1234567890abcd", product: "publisher" }),
      deps({ gateway: fakeGateway({}), io }),
    );
    expect(code).toBe(EXIT_FAILED);
  });

  it("uses a placeholder and warns when the key prompt is left blank", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo(["", true, true]);
    const gateway = fakeGateway({ json: RECON_FIXTURE, runs });

    const code = await runWizard(args({ product: "publisher" }), deps({ gateway, io }));

    expect(code).toBe(EXIT_OK);
    expect(runs[1].prompt).toContain(placeholderKey("publisher"));
    expect(io.output).toContain("placeholder you must replace");
    expect(io.output).toContain("Replace it with your real publisher key");
  });

  it("uses a placeholder under --yes with no key, since it cannot ask", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo();
    const gateway = fakeGateway({ json: RECON_FIXTURE, runs });

    await runWizard(args({ product: "publisher", yes: true }), deps({ gateway, io }));

    expect(runs[1].prompt).toContain(placeholderKey("publisher"));
  });

  it("says nothing about placeholders when a real key was given", async () => {
    const io = new ScriptedIo();
    const gateway = fakeGateway({ json: RECON_FIXTURE });

    await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }), deps({ gateway, io }));

    expect(io.output).not.toContain("placeholder");
  });
});

describe("runWizard — choosing an agent", () => {
  it("asks which agent when several are installed", async () => {
    const io = new ScriptedIo(["agent-1", true]);
    const gateway = fakeGateway({ agents: [{}, {}], json: RECON_FIXTURE });

    const code = await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(code).toBe(EXIT_OK);
    expect(io.asked[0]).toContain("Which coding agent");
  });

  it("uses the only installed agent without asking", async () => {
    const io = new ScriptedIo([true]);
    const gateway = fakeGateway({ json: RECON_FIXTURE });

    await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(io.asked.some((question) => question.includes("Which coding agent"))).toBe(false);
    expect(io.output).toContain("Using Agent 0");
  });

  it("honours --agent and skips the picker", async () => {
    const io = new ScriptedIo([true]);
    const gateway = fakeGateway({ agents: [{}, {}], json: RECON_FIXTURE });

    const code = await runWizard(
      args({ agent: "agent-1", key: VALID_PUBLISHER_KEY, product: "publisher" }),
      deps({ gateway, io }),
    );

    expect(code).toBe(EXIT_OK);
    expect(io.asked.some((question) => question.includes("Which coding agent"))).toBe(false);
  });

  it("fails with the installed ids when --agent names something absent", async () => {
    const io = new ScriptedIo();
    const gateway = fakeGateway({ agents: [{ id: "claude-code" }] });

    const code = await runWizard(
      args({ agent: "nope", key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io }),
    );

    expect(code).toBe(EXIT_FAILED);
    expect(io.output).toContain("claude-code");
  });
});

describe("runWizard — cancellation", () => {
  it.each([
    ["the product picker", args(), [CANCELLED] as Answer[]],
    ["the key prompt", args({ product: "publisher" }), [CANCELLED] as Answer[]],
  ])("stops cleanly when the user cancels %s", async (_label, wizardArgs, answers) => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo(answers);

    const code = await runWizard(wizardArgs, deps({ gateway: fakeGateway({ runs }), io }));

    expect(code).toBe(EXIT_CANCELLED);
    expect(runs).toHaveLength(0);
    expect(io.printed.some((entry) => entry.kind === "cancel")).toBe(true);
  });
});

describe("runWizard — outcome", () => {
  it("fails and tells the user to check git when the implementation run throws", async () => {
    const io = new ScriptedIo();
    const gateway = fakeGateway({
      failOn: (prompt) => (prompt.includes("Your task") ? new Error("agent crashed") : undefined),
      json: RECON_FIXTURE,
    });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io }),
    );

    expect(code).toBe(EXIT_FAILED);
    expect(io.output).toContain("agent crashed");
    expect(io.output).toContain("git status");
  });

  it("fails when a required marker is missing after the run", async () => {
    const io = new ScriptedIo();
    const gateway = fakeGateway({ json: RECON_FIXTURE });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io, verify: async () => verification(false) }),
    );

    expect(code).toBe(EXIT_FAILED);
    expect(io.output).toContain("Some required parts of the integration are missing");
    expect(io.output).toContain("Finished with gaps");
  });

  it("warns when git reports no changes at all", async () => {
    const io = new ScriptedIo();
    const gateway = fakeGateway({ json: RECON_FIXTURE });

    await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io, readDiffStat: async () => null }),
    );

    expect(io.output).toContain("git reports no changes");
  });

  it("verifies the tree the user pointed at, not the current directory", async () => {
    const io = new ScriptedIo();
    const seen: string[] = [];
    const gateway = fakeGateway({ json: RECON_FIXTURE });

    await runWizard(
      args({ dir: "/srv/other", key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({
        gateway,
        io,
        verify: async (dir: string, product: ProductId) => {
          seen.push(`${dir}:${product}`);
          return verification(true);
        },
      }),
    );

    expect(seen).toEqual(["/srv/other:publisher"]);
  });
});
