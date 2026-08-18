/**
 * The seam between the wizard and AnyAgent.
 *
 * Everything downstream talks to `AgentGateway` and `AgentRunner`, which are
 * small enough to fake in a test without a subprocess. `createAnyAgentGateway`
 * is the only place in the package that imports `anyagent-js`, so the
 * orchestrator can be exercised end to end with no coding agent installed.
 */

import { type DetectOptions, create, detect } from "anyagent-js";
import type { AgentEvent, BaselineRunOptions, DetectResult } from "anyagent-js/types";

/** One coding agent found on the machine. */
export interface AgentOption {
  /** Whether a read-only investigation pass is possible on this agent. */
  canReadOnly: boolean;
  /** Whether this agent can return output shaped to a JSON schema. */
  canSchema: boolean;
  /** Stable id, e.g. "claude-code". */
  id: string;
  /** Human-readable name, e.g. "Claude Code". */
  name: string;
  version?: string;
}

/** One normalized event, reduced to the fields the wizard renders. */
export interface WizardRunEvent {
  /** For file changes: "create" | "modify" | "delete". */
  kind?: string;
  /** For file changes: the path touched. */
  path?: string;
  /** For text and reasoning deltas. */
  text?: string;
  /** For tool calls, in AnyAgent's shared vocabulary. */
  toolName?: string;
  type: string;
}

export interface WizardRunResult {
  /** The schema-validated value, when the run was given a schema. */
  json?: unknown;
  text: string;
}

/** One run in flight: iterate `events`, then await `done`. */
export interface WizardRun {
  done: Promise<WizardRunResult>;
  events: AsyncIterable<WizardRunEvent>;
}

export interface WizardRunOptions {
  /** Directory the agent works in. */
  cwd: string;
  /** Confine the run to reading. Only valid when `canReadOnly`. */
  readOnly?: boolean;
  /** JSON Schema for the reply; the validated value lands on `done`'s `json`. */
  schema?: Record<string, unknown>;
  systemPrompt?: string;
}

/** A coding agent the wizard can drive. */
export interface AgentRunner extends AgentOption {
  run: (prompt: string, options: WizardRunOptions) => WizardRun;
}

/** Discovery and construction of coding agents. */
export interface AgentGateway {
  list: () => Promise<AgentOption[]>;
  open: (id: string) => Promise<AgentRunner>;
}

/**
 * Reduce an AnyAgent event to the fields the wizard shows.
 *
 * @param event - A normalized AnyAgent event
 * @returns The wizard's view of it
 */
export function toWizardEvent(event: AgentEvent): WizardRunEvent {
  switch (event.type) {
    case "text-delta":
    case "reasoning-delta":
      return { text: event.text, type: event.type };
    case "tool-call":
    case "tool-result":
      return { toolName: event.name, type: event.type };
    case "file-change":
      return { kind: event.kind, path: event.path, type: event.type };
    default:
      return { type: event.type };
  }
}

/**
 * A one-line progress message for an event, or null when the event is not
 * worth interrupting the user for.
 *
 * Text and reasoning deltas are deliberately dropped: a spinner that reprints
 * every token is noise, and the agent's prose is shown at the end anyway.
 *
 * @param event - The wizard's view of an event
 * @returns A short status line, or null
 */
export function describeEvent(event: WizardRunEvent): string | null {
  switch (event.type) {
    case "file-change":
      return `${event.kind ?? "changed"} ${event.path ?? "a file"}`;
    case "tool-call":
      return `running ${event.toolName ?? "a tool"}`;
    case "schema-retry":
      return "asking again for a well-formed answer";
    case "permission-request":
      return "approving a tool request";
    default:
      return null;
  }
}

function toOption(result: DetectResult): AgentOption {
  return {
    canReadOnly: result.capabilities.readOnly !== false,
    canSchema: result.capabilities.structuredOutput !== false,
    id: result.id,
    name: result.name,
    version: result.version,
  };
}

async function* mapEvents(source: AsyncIterable<AgentEvent>): AsyncGenerator<WizardRunEvent> {
  for await (const event of source) {
    yield toWizardEvent(event);
  }
}

function toRunner(result: DetectResult): AgentRunner {
  const agent = create(result);
  const option = toOption(result);

  return {
    ...option,
    run(prompt: string, options: WizardRunOptions): WizardRun {
      const base: BaselineRunOptions = { cwd: options.cwd };
      if (options.systemPrompt) {
        base.systemPrompt = options.systemPrompt;
      }
      if (options.schema) {
        base.schema = options.schema;
        base.schemaRetries = 1;
      }

      // `supports` is both the runtime gate and the type narrowing that makes
      // `readOnly` a legal option on an agent detected at runtime.
      const run =
        options.readOnly && agent.supports("readOnly")
          ? agent.run(prompt, { ...base, readOnly: true })
          : agent.run(prompt, base);

      const done = run.then((value) => ({ json: value.json, text: value.text }));
      // Keep an early failure from surfacing as an unhandled rejection while
      // the caller is still draining events. `done` itself still rejects.
      done.catch(() => undefined);

      return { done, events: mapEvents(run) };
    },
  };
}

/**
 * The real gateway: AnyAgent's `detect()` and `create()`.
 *
 * Detection runs once and is cached, so `list()` then `open()` does not rescan
 * the PATH.
 *
 * @param options - AnyAgent detection overrides. Production passes none; tests
 *   pass a fake `probe` and a stub `adapters` list to drive this code path
 *   without a coding agent installed.
 * @returns A gateway over whatever coding agents this machine has
 */
export function createAnyAgentGateway(options?: DetectOptions): AgentGateway {
  let cached: Promise<DetectResult[]> | null = null;

  const results = (): Promise<DetectResult[]> => {
    cached ??= detect(options);
    return cached;
  };

  return {
    async list(): Promise<AgentOption[]> {
      return (await results()).map(toOption);
    },
    async open(id: string): Promise<AgentRunner> {
      const match = (await results()).find((result) => result.id === id);
      if (!match) {
        throw new Error(`No installed coding agent with id "${id}".`);
      }
      return toRunner(match);
    },
  };
}
