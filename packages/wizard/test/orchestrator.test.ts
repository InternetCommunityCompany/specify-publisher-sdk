import { describe, expect, it } from "bun:test";
import type {
  AgentGateway,
  AgentOption,
  AgentRunner,
  WizardRun,
  WizardRunOptions,
  WizardSession,
  WizardTurnOptions,
} from "../lib/agent";
import type { WizardArgs } from "../lib/args";
import { CANCELLED, type SelectChoice, type WizardIo, type WizardSpinner } from "../lib/io";
import { placeholderKey } from "../lib/keys";
import { EXIT_CANCELLED, EXIT_FAILED, EXIT_OK, type WizardDeps, runWizard } from "../lib/orchestrator";
import type { ProductId } from "../lib/products";
import { PUBLISHER_REFERENCE } from "../lib/references";
import type { VerificationResult } from "../lib/verify";
import { RECON_FIXTURE, REPORT_FIXTURE, VALID_PUBLISHER_KEY } from "./fixtures";

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
  /** The choices every picker offered, so a missing option can be asserted. */
  readonly offered: string[][] = [];
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

  async select(message: string, choices: SelectChoice[]): Promise<string | typeof CANCELLED> {
    this.offered.push(choices.map((choice) => choice.value));
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
  /** Whether the turn went through the conversation or a one-shot run. */
  via: "run" | "session";
}

/** What one scripted turn does: answer, or fail. */
interface ScriptedTurn {
  error?: unknown;
  json?: unknown;
  text?: string;
}

/**
 * A gateway over fake runners that record their prompts instead of running.
 *
 * `replies` scripts the conversation turn by turn; once it runs out, every
 * further turn answers with the flat `json`/`text` defaults. `noSession` makes
 * `session()` throw, which is how a real agent that cannot resume behaves and
 * is the wizard's signal to fall back to one-shot runs.
 */
function fakeGateway(options: {
  agents?: Partial<AgentOption>[];
  closed?: string[];
  failOn?: (prompt: string) => Error | undefined;
  json?: unknown;
  noSession?: boolean;
  replies?: ScriptedTurn[];
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

      let turn = 0;
      const start = (prompt: string, runOptions: WizardRunOptions, via: "run" | "session"): WizardRun => {
        runs.push({ options: runOptions, prompt, via });
        const scripted = options.replies?.[turn];
        turn += 1;

        const failure = options.failOn?.(prompt) ?? scripted?.error;
        const value = scripted
          ? { json: scripted.json, text: scripted.text ?? "" }
          : { json: options.json, text: options.text ?? "" };

        const done = failure ? Promise.reject(failure) : Promise.resolve(value);
        done.catch(() => undefined);

        return {
          done,
          events: (async function* () {
            yield { kind: "modify", path: "app/layout.tsx", type: "file-change" };
          })(),
        };
      };

      return {
        ...agent,
        run: (prompt: string, runOptions: WizardRunOptions) => start(prompt, runOptions, "run"),
        session({ cwd }: { cwd: string }): WizardSession {
          if (options.noSession) {
            throw new Error("agent-0 cannot continue a conversation");
          }
          return {
            close: async () => {
              options.closed?.push(cwd);
            },
            run: (prompt: string, turnOptions: WizardTurnOptions = {}) =>
              start(prompt, { ...turnOptions, cwd }, "session"),
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

describe("runWizard — the two-turn flow", () => {
  it("runs recon read-only, then implementation, as turns of one conversation", async () => {
    const runs: RecordedRun[] = [];
    const closed: string[] = [];
    const io = new ScriptedIo();
    const gateway = fakeGateway({ closed, json: RECON_FIXTURE, runs, text: "Added the provider." });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io }),
    );

    expect(code).toBe(EXIT_OK);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.via)).toEqual(["session", "session"]);
    expect(closed).toEqual(["/srv/app"]);

    expect(runs[0].options.readOnly).toBe(true);
    expect(runs[0].options.schema).toBeDefined();
    expect(runs[0].options.schemaRetries).toBeUndefined();
    expect(runs[0].options.cwd).toBe("/srv/app");
    expect(runs[0].prompt).toContain("READ-ONLY");

    expect(runs[1].options.readOnly).toBeUndefined();
    expect(runs[1].prompt).toContain(VALID_PUBLISHER_KEY);
    expect(runs[1].prompt).toContain("Cookiebot");
    expect(runs[1].prompt).toContain("NEVER hardcode consent as granted");
  });

  it("asks the editing turn for a report, and never lets a bad reply re-run it", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo();
    const gateway = fakeGateway({ json: RECON_FIXTURE, runs });

    await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }), deps({ gateway, io }));

    const schema = runs[1].options.schema as Record<string, unknown>;
    expect(schema.required).toEqual(["summary", "status"]);
    expect(runs[1].options.schemaRetries).toBe(0);
  });

  it("shows the plan and everything the turn reported", async () => {
    const io = new ScriptedIo();
    const gateway = fakeGateway({ replies: [{ json: RECON_FIXTURE }, { json: REPORT_FIXTURE }] });

    await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }), deps({ gateway, io }));

    expect(io.output).toContain("next (app-router)");
    expect(io.output).toContain("Added the provider.");
    expect(io.output).toContain("app/providers/specify.tsx — creates the shared client");
    expect(io.output).toContain("No CMP found");
    expect(io.output).toContain("Review the diff before you commit");
    expect(io.output).toContain("https://docs.specify.sh/publishing/sdk-reference");
  });

  it("falls back to the turn's own words when it reported no structure", async () => {
    const io = new ScriptedIo();
    const gateway = fakeGateway({ replies: [{ json: RECON_FIXTURE }, { text: "I added the provider." }] });

    await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }), deps({ gateway, io }));

    expect(io.output).toContain("I added the provider.");
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
    const gateway = fakeGateway({ agents: [{ canSchema: false }], runs, text: "I wired it up." });

    await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }), deps({ gateway, io }));

    expect(runs).toHaveLength(1);
    expect(runs[0].prompt).toContain("Investigate before you edit");
    // Asking an agent without structured output for JSON would only put JSON
    // where the user expects prose.
    expect(runs[0].options.schema).toBeUndefined();
    expect(runs[0].prompt).toContain("Finish by summarising, in your final message");
    expect(io.output).toContain("I wired it up.");
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

  it("stops with login guidance when recon fails on authentication, instead of a doomed fallback", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo();
    const gateway = fakeGateway({
      failOn: (prompt) =>
        prompt.includes("READ-ONLY")
          ? new Error("Failed to authenticate: OAuth session expired and could not be refreshed")
          : undefined,
      runs,
    });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io }),
    );

    expect(code).toBe(EXIT_FAILED);
    // No second run: every turn shares the login, so the fallback would fail identically.
    expect(runs).toHaveLength(1);
    expect(io.output).toContain("not logged in");
    expect(io.output).toContain("claude login");
    expect(io.output).toContain("Nothing was changed");
  });

  it("names the real reason in the dry-run outro when recon failed rather than being unsupported", async () => {
    const io = new ScriptedIo();
    const gateway = fakeGateway({
      failOn: (prompt) => (prompt.includes("READ-ONLY") ? new Error("recon exploded") : undefined),
    });

    const code = await runWizard(
      args({ dryRun: true, key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io }),
    );

    expect(code).toBe(EXIT_OK);
    expect(io.output).toContain("The investigation failed");
    expect(io.output).not.toContain("cannot investigate read-only");
  });

  it("retries recon once after a transient provider error and carries on", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo();
    const gateway = fakeGateway({
      replies: [
        { error: new Error("API Error: 529 Overloaded. This is a server-side issue, usually temporary") },
        { json: RECON_FIXTURE },
        { json: REPORT_FIXTURE },
      ],
      runs,
    });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io, sleep: async () => undefined }),
    );

    expect(code).toBe(EXIT_OK);
    expect(io.output).toContain("Trying once more");
    // Two recon attempts, then one implementation turn — no combined-pass fallback.
    expect(runs).toHaveLength(3);
    expect(runs[0].prompt).toBe(runs[1].prompt);
  });

  it("retries the implementation once after a transient error, telling the agent to reconcile partial work", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo();
    const gateway = fakeGateway({
      replies: [
        { json: RECON_FIXTURE },
        { error: new Error("API Error: Server error mid-response.") },
        { json: REPORT_FIXTURE },
      ],
      runs,
    });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io, sleep: async () => undefined }),
    );

    expect(code).toBe(EXIT_OK);
    expect(runs).toHaveLength(3);
    expect(runs[1].prompt).not.toContain("interrupted partway");
    expect(runs[2].prompt).toContain("interrupted partway");
  });

  it("gives up after a second transient failure instead of retrying forever", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo();
    const gateway = fakeGateway({
      replies: [
        { json: RECON_FIXTURE },
        { error: new Error("API Error: 529 Overloaded") },
        { error: new Error("API Error: 529 Overloaded") },
      ],
      runs,
    });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io, sleep: async () => undefined }),
    );

    expect(code).toBe(EXIT_FAILED);
    expect(runs).toHaveLength(3);
  });

  it("adds login guidance when the implementation turn fails on authentication", async () => {
    const io = new ScriptedIo();
    const gateway = fakeGateway({
      failOn: (prompt) => (prompt.includes("READ-ONLY") ? undefined : new Error("please log in: token rejected")),
    });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io }),
    );

    expect(code).toBe(EXIT_FAILED);
    expect(io.output).toContain("claude login");
  });
});

/** A recon reply, then the report the implementation turn answers with. */
function conversation(...reports: unknown[]): ScriptedTurn[] {
  return [{ json: RECON_FIXTURE }, ...reports.map((json) => ({ json }))];
}

const QUESTIONING_REPORT = {
  ...REPORT_FIXTURE,
  questions: [{ context: "there are two candidates", question: "Which slot should the ad go in?" }],
  summary: "Added the provider, but I could not pick a slot.",
};

describe("runWizard — the conversation loop", () => {
  it("finishes on the first turn when the user is happy with it", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo([true, "finish"]);
    const gateway = fakeGateway({ replies: conversation(REPORT_FIXTURE), runs });

    const code = await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(code).toBe(EXIT_OK);
    expect(runs).toHaveLength(2);
    expect(io.asked.at(-1)).toBe("What next?");
    expect(io.output).toContain("Verification");
  });

  it("sends a change request as another turn of the same conversation", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo([true, "changes", "Move the ad below the fold.", "finish"]);
    const gateway = fakeGateway({
      replies: conversation(REPORT_FIXTURE, { ...REPORT_FIXTURE, summary: "Moved the ad below the fold." }),
      runs,
    });

    const code = await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(code).toBe(EXIT_OK);
    expect(runs).toHaveLength(3);
    expect(runs[2].via).toBe("session");
    expect(runs[2].prompt).toContain("Move the ad below the fold.");
    expect(runs[2].options.schemaRetries).toBe(0);
    // The session already holds all of this; resending it every turn would
    // invite the agent to start over.
    expect(runs[2].prompt).not.toContain(PUBLISHER_REFERENCE);
    expect(runs[2].prompt.length).toBeLessThan(runs[1].prompt.length);
    expect(io.output).toContain("Moved the ad below the fold.");
  });

  it("keeps looping until the user says they are done", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo([true, "changes", "first", "changes", "second", "changes", "third", "finish"]);
    const gateway = fakeGateway({ replies: conversation(REPORT_FIXTURE), runs });

    expect(await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }))).toBe(
      EXIT_OK,
    );
    expect(runs).toHaveLength(5);
  });

  it("offers to answer the agent's questions, and quotes them into the turn", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo([true, "answers", "Use the sidebar slot.", "finish"]);
    const gateway = fakeGateway({ replies: conversation(QUESTIONING_REPORT, REPORT_FIXTURE), runs });

    const code = await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(code).toBe(EXIT_OK);
    expect(io.output).toContain("It needs you to decide");
    expect(io.output).toContain("1. Which slot should the ad go in?");
    expect(io.offered[0]).toEqual(["finish", "changes", "answers", "abort"]);
    expect(runs[2].prompt).toContain("Which slot should the ad go in?");
    expect(runs[2].prompt).toContain("Use the sidebar slot.");
  });

  it("does not offer to answer questions that were never asked", async () => {
    const io = new ScriptedIo([true, "finish"]);
    const gateway = fakeGateway({ replies: conversation(REPORT_FIXTURE) });

    await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(io.offered[0]).toEqual(["finish", "changes", "abort"]);
  });

  it("shows a reply that failed its schema as it came back, and carries on", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo([true, "changes", "please report properly", "finish"]);
    const gateway = fakeGateway({
      replies: [
        { json: RECON_FIXTURE },
        { error: { code: "Parse", issues: ["$.summary: required"], raw: "I changed four files and stopped." } },
        { json: REPORT_FIXTURE },
      ],
      runs,
    });

    const code = await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(code).toBe(EXIT_OK);
    // The failed turn ran exactly once: no automatic second pass over the repo.
    expect(runs).toHaveLength(3);
    expect(io.output).toContain("I changed four files and stopped.");
    expect(io.output).toContain("did not match the shape");
    expect(io.output).toContain("$.summary: required");
  });

  it("keeps the conversation open when a follow-up turn fails outright", async () => {
    const io = new ScriptedIo([true, "changes", "do it differently", "finish"]);
    const gateway = fakeGateway({
      replies: [{ json: RECON_FIXTURE }, { json: REPORT_FIXTURE }, { error: new Error("turn exploded") }],
    });

    const code = await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(code).toBe(EXIT_OK);
    expect(io.output).toContain("turn exploded");
    expect(io.output).toContain("conversation is still open");
  });

  it("does not send an empty change request", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo([true, "changes", "   ", "finish"]);
    const gateway = fakeGateway({ replies: conversation(REPORT_FIXTURE), runs });

    await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(runs).toHaveLength(2);
    expect(io.output).toContain("Nothing to send");
  });

  it("offers to feed a verification gap back to the agent, then re-checks", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo([true, "finish", true, "finish"]);
    const gateway = fakeGateway({ replies: conversation(REPORT_FIXTURE, REPORT_FIXTURE), runs });
    let scans = 0;

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher" }),
      deps({
        gateway,
        io,
        verify: async () => {
          scans += 1;
          return verification(scans > 1);
        },
      }),
    );

    expect(code).toBe(EXIT_OK);
    expect(scans).toBe(2);
    expect(runs).toHaveLength(3);
    expect(runs[2].prompt).toContain("The wizard scanned the project");
    expect(runs[2].prompt).toContain("wire it");
  });

  it("takes no for an answer on the verification gap and reports the gap", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo([true, "finish", false]);
    const gateway = fakeGateway({ replies: conversation(REPORT_FIXTURE), runs });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher" }),
      deps({ gateway, io, verify: async () => verification(false) }),
    );

    expect(code).toBe(EXIT_FAILED);
    expect(runs).toHaveLength(2);
    expect(io.output).toContain("Some required parts of the integration are missing");
  });

  it("stops on abort and says the changes are still in the tree", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo([true, "abort"]);
    const gateway = fakeGateway({ replies: conversation(REPORT_FIXTURE), runs });

    const code = await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(code).toBe(EXIT_CANCELLED);
    expect(runs).toHaveLength(2);
    expect(io.output).toContain("still in your tree");
    expect(io.printed.some((entry) => entry.kind === "cancel")).toBe(true);
  });

  it("treats a cancelled menu the same as an abort", async () => {
    const io = new ScriptedIo([true, CANCELLED]);
    const gateway = fakeGateway({ replies: conversation(REPORT_FIXTURE) });

    expect(await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }))).toBe(
      EXIT_CANCELLED,
    );
  });

  it("never opens the loop under --yes, because nobody is there to answer", async () => {
    const io = new ScriptedIo();
    const gateway = fakeGateway({ replies: conversation(QUESTIONING_REPORT) });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher", yes: true }),
      deps({ gateway, io }),
    );

    expect(code).toBe(EXIT_OK);
    expect(io.asked).toEqual([]);
    expect(io.output).toContain("Which slot should the ad go in?");
    expect(io.output).toContain("nobody was there to answer");
  });
});

describe("runWizard — an agent that cannot hold a conversation", () => {
  it("falls back to one-shot runs and never offers follow-ups", async () => {
    const runs: RecordedRun[] = [];
    const io = new ScriptedIo([true]);
    const gateway = fakeGateway({ noSession: true, replies: conversation(REPORT_FIXTURE), runs });

    const code = await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(code).toBe(EXIT_OK);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.via)).toEqual(["run", "run"]);
    expect(runs.every((run) => run.options.cwd === "/srv/app")).toBe(true);
    expect(io.output).toContain("cannot hold a multi-turn conversation");
    expect(io.asked).toEqual(["Apply this plan?"]);
    expect(io.output).toContain("Added the provider.");
  });

  it("still investigates, plans and verifies", async () => {
    const io = new ScriptedIo([true]);
    const gateway = fakeGateway({ noSession: true, replies: conversation(REPORT_FIXTURE) });

    await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(io.output).toContain("next (app-router)");
    expect(io.output).toContain("Verification");
    expect(io.output).toContain("Review the diff before you commit");
  });

  it("does not offer to fix a verification gap it could not act on", async () => {
    const io = new ScriptedIo([true]);
    const gateway = fakeGateway({ noSession: true, replies: conversation(REPORT_FIXTURE) });

    const code = await runWizard(
      args({ key: VALID_PUBLISHER_KEY, product: "publisher" }),
      deps({ gateway, io, verify: async () => verification(false) }),
    );

    expect(code).toBe(EXIT_FAILED);
    expect(io.asked).toEqual(["Apply this plan?"]);
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
    const io = new ScriptedIo([true, true, "finish"]);
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
    const io = new ScriptedIo([true, true, "finish"]);
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
    const io = new ScriptedIo([true, "finish"]);
    const gateway = fakeGateway({ json: RECON_FIXTURE });

    await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(io.asked).toEqual(["Apply this plan?", "What next?"]);
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
    const io = new ScriptedIo(["advertiser", VALID_PUBLISHER_KEY.replace("spk_", "adv_"), true, "finish"]);
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
    const io = new ScriptedIo(["", true, "finish"]);
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
    const io = new ScriptedIo(["agent-1", true, "finish"]);
    const gateway = fakeGateway({ agents: [{}, {}], json: RECON_FIXTURE });

    const code = await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(code).toBe(EXIT_OK);
    expect(io.asked[0]).toContain("Which coding agent");
  });

  it("uses the only installed agent without asking", async () => {
    const io = new ScriptedIo([true, "finish"]);
    const gateway = fakeGateway({ json: RECON_FIXTURE });

    await runWizard(args({ key: VALID_PUBLISHER_KEY, product: "publisher" }), deps({ gateway, io }));

    expect(io.asked.some((question) => question.includes("Which coding agent"))).toBe(false);
    expect(io.output).toContain("Using Agent 0");
  });

  it("honours --agent and skips the picker", async () => {
    const io = new ScriptedIo([true, "finish"]);
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
