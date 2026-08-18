/**
 * The seam between the wizard and AnyAgent.
 *
 * Everything downstream talks to `AgentGateway`, `AgentRunner` and
 * `WizardSession`, which are small enough to fake in a test without a
 * subprocess. `createAnyAgentGateway` is the only place in the package that
 * imports `anyagent-js`, so the orchestrator can be exercised end to end with
 * no coding agent installed.
 */

import { type DetectOptions, create, detect } from "anyagent-js";
import type { AgentEvent, BaselineRunOptions, DetectResult, Run } from "anyagent-js/types";

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

/** What one turn may ask for. Everything else belongs to the conversation. */
export interface WizardTurnOptions {
  /** Confine the turn to reading. Only valid when `canReadOnly`. */
  readOnly?: boolean;
  /** JSON Schema for the reply; the validated value lands on `done`'s `json`. */
  schema?: Record<string, unknown>;
  /**
   * How many times AnyAgent may re-ask when the reply fails the schema. The
   * default of 1 costs a second full agent run, which is fine on a read-only
   * turn and unacceptable on a turn that edits the repo — pass 0 there and
   * handle the `Parse` failure with `asSchemaFailure`.
   */
  schemaRetries?: 0 | 1;
  systemPrompt?: string;
}

export interface WizardRunOptions extends WizardTurnOptions {
  /** Directory the agent works in. */
  cwd: string;
}

/**
 * One conversation with an agent, spanning many turns.
 *
 * The working directory is fixed for the whole conversation; each turn brings
 * only its own prompt and options, and inherits everything the earlier turns
 * read and did.
 */
export interface WizardSession {
  close: () => Promise<void>;
  run: (prompt: string, options?: WizardTurnOptions) => WizardRun;
}

/** A coding agent the wizard can drive. */
export interface AgentRunner extends AgentOption {
  run: (prompt: string, options: WizardRunOptions) => WizardRun;
  /**
   * Open a multi-turn conversation. Throws when this agent cannot hold one —
   * every stdout-mode CLI that cannot resume is in that category — which is the
   * signal to fall back to one-shot `run` calls.
   */
  session: (options: { cwd: string }) => WizardSession;
}

/** A reply that failed its schema, with the text the agent actually sent. */
export interface SchemaFailure {
  /** The checks the reply failed, one entry each. */
  issues: string[];
  /** The reply verbatim, so it can be shown instead of thrown away. */
  raw: string;
}

/**
 * Recognise a schema-validation failure among whatever a turn threw.
 *
 * Duck-typed rather than `instanceof AnyAgentError` on purpose: it keeps the
 * check honest across duplicated module instances, and it lets the orchestrator
 * tests raise a plain object without importing AnyAgent at all.
 *
 * @param error - Whatever a turn rejected with
 * @returns The failed reply, or null when the failure was something else
 */
export function asSchemaFailure(error: unknown): SchemaFailure | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const candidate = error as { code?: unknown; issues?: unknown; raw?: unknown };
  if (candidate.code !== "Parse") {
    return null;
  }
  return {
    issues: Array.isArray(candidate.issues) ? candidate.issues.map((issue) => String(issue)) : [],
    raw: typeof candidate.raw === "string" ? candidate.raw : "",
  };
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

/** The parts of a turn that every agent accepts, whatever its capabilities. */
function toBaseline(options: WizardTurnOptions): BaselineRunOptions {
  const base: BaselineRunOptions = {};
  if (options.systemPrompt) {
    base.systemPrompt = options.systemPrompt;
  }
  if (options.schema) {
    base.schema = options.schema;
    // `schemaRetries` without `schema` is rejected before anything spawns.
    base.schemaRetries = options.schemaRetries ?? 1;
  }
  return base;
}

function toWizardRun(run: Run): WizardRun {
  const done = run.then((value) => ({ json: value.json, text: value.text }));
  // Keep an early failure from surfacing as an unhandled rejection while the
  // caller is still draining events. `done` itself still rejects.
  done.catch(() => undefined);
  return { done, events: mapEvents(run) };
}

function toRunner(result: DetectResult): AgentRunner {
  const agent = create(result);
  const option = toOption(result);

  return {
    ...option,
    run(prompt: string, options: WizardRunOptions): WizardRun {
      const base = { ...toBaseline(options), cwd: options.cwd };

      // `supports` is both the runtime gate and the type narrowing that makes
      // `readOnly` a legal option on an agent detected at runtime.
      return toWizardRun(
        options.readOnly && agent.supports("readOnly")
          ? agent.run(prompt, { ...base, readOnly: true })
          : agent.run(prompt, base),
      );
    },
    session(options: { cwd: string }): WizardSession {
      // The branch is duplicated because narrowing lives on the agent: only a
      // session opened from the narrowed agent has `readOnly` as a legal
      // per-turn option. `session()` itself throws on an agent that cannot
      // continue a conversation, and that throw is the caller's fallback signal.
      if (agent.supports("readOnly")) {
        const session = agent.session({ cwd: options.cwd });
        return {
          close: () => session.close(),
          run: (prompt: string, turn: WizardTurnOptions = {}) =>
            toWizardRun(session.run(prompt, { ...toBaseline(turn), readOnly: turn.readOnly === true })),
        };
      }

      const session = agent.session({ cwd: options.cwd });
      return {
        close: () => session.close(),
        run: (prompt: string, turn: WizardTurnOptions = {}) => toWizardRun(session.run(prompt, toBaseline(turn))),
      };
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
