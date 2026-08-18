/**
 * The turn report: what every editing turn answers with, and how the wizard
 * shows it.
 *
 * Structuring an agent turn like a tool call is what turns a one-shot run into
 * a conversation — the wizard gets a summary, a file list, the decisions the
 * agent made on its own and the questions it could not settle, all as data it
 * can render and act on rather than prose it can only print.
 *
 * The same philosophy as `normalizeRecon` applies: the schema is deliberately
 * forgiving, the normalizer never throws, and a half-answered report still
 * produces something the user can read and reply to.
 */

export const TURN_STATUSES = ["complete", "blocked"] as const;
export type TurnStatus = (typeof TURN_STATUSES)[number];

export interface TurnFileChange {
  /** Project-relative path, as the agent named it. */
  path: string;
  /** One line on what changed there. */
  what: string;
}

export interface TurnDecision {
  /** The choice the agent made without asking. */
  decision: string;
  why: string;
}

export interface TurnQuestion {
  /** Why it is being asked, when the agent bothered to say. */
  context?: string;
  question: string;
}

export interface TurnReport {
  decisions: TurnDecision[];
  filesChanged: TurnFileChange[];
  /** Anything the normalizer could not read, collected during normalization. */
  notes: string[];
  /** Genuinely ambiguous things the developer should settle. */
  questions: TurnQuestion[];
  status: TurnStatus;
  summary: string;
  /** Things done that the developer must know about, e.g. a consent stub. */
  warnings: string[];
}

/**
 * The JSON Schema every editing turn is asked to answer with.
 *
 * Flat and open on purpose. `additionalProperties` is left unset for the same
 * reason as the recon schema: where structured output is emulated, a strict
 * schema turns a mostly-correct reply into a hard parse failure, and the
 * normalizer discards extras anyway. Only `summary` and `status` are required,
 * so a turn with nothing to warn about is not forced to invent a warning.
 *
 * @returns A plain JSON Schema object for a turn's `schema` option
 */
export function turnReportSchema(): Record<string, unknown> {
  return {
    properties: {
      decisions: {
        description: "Choices you made on your own that a reviewer would want to know you made, and why.",
        items: {
          properties: { decision: { type: "string" }, why: { type: "string" } },
          required: ["decision", "why"],
          type: "object",
        },
        type: "array",
      },
      filesChanged: {
        description: "Every file you created, modified or deleted, with one line on what changed in it.",
        items: {
          properties: { path: { type: "string" }, what: { type: "string" } },
          required: ["path", "what"],
          type: "object",
        },
        type: "array",
      },
      questions: {
        description:
          "Things you could not settle from the code that the developer should decide. Ask only about genuine ambiguity — not for permission to do the task.",
        items: {
          properties: { context: { type: "string" }, question: { type: "string" } },
          required: ["question"],
          type: "object",
        },
        type: "array",
      },
      status: {
        description: '"complete" when you finished what was asked, "blocked" when something stopped you.',
        enum: [...TURN_STATUSES],
        type: "string",
      },
      summary: { description: "What you did on this turn, in a few sentences.", type: "string" },
      warnings: {
        description:
          'Anything the developer must know about, e.g. "no consent platform found — added a consent stub with a TODO".',
        items: { type: "string" },
        type: "array",
      },
    },
    required: ["summary", "status"],
    type: "object",
  };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => item !== null)
    : [];
}

/**
 * Turn whatever an editing turn returned into a `TurnReport`.
 *
 * Nothing here throws. When the turn returned no structured value at all — an
 * agent that cannot do structured output, or a reply that failed validation and
 * was surfaced verbatim instead — `fallbackText` becomes the summary, which is
 * exactly the one-shot behaviour the wizard had before the report existed.
 *
 * @param raw - The turn's `json`, or null when there was none
 * @param fallbackText - The turn's plain text, used when there is no summary
 * @returns A report the conversation loop can render unconditionally
 */
export function normalizeTurnReport(raw: unknown, fallbackText = ""): TurnReport {
  const notes: string[] = [];
  const root = asRecord(raw);
  const text = fallbackText.trim();

  const summary = asString(root?.summary, text);
  if (summary === "") {
    notes.push("The agent said nothing about what it did.");
  }

  const filesChanged: TurnFileChange[] = records(root?.filesChanged)
    .map((item) => ({ path: asString(item.path), what: asString(item.what) }))
    .filter((item) => item.path !== "");

  const decisions: TurnDecision[] = records(root?.decisions)
    .map((item) => ({ decision: asString(item.decision), why: asString(item.why) }))
    .filter((item) => item.decision !== "");

  const questions: TurnQuestion[] = records(root?.questions)
    .map((item) => ({ context: asString(item.context) || undefined, question: asString(item.question) }))
    .filter((item) => item.question !== "");

  const warnings: string[] = (Array.isArray(root?.warnings) ? root.warnings : [])
    .map((item) => asString(item))
    .filter((item) => item !== "");

  const status: TurnStatus = root?.status === "blocked" ? "blocked" : "complete";

  return { decisions, filesChanged, notes, questions, status, summary, warnings };
}

/**
 * Render a report as the block shown after every turn.
 *
 * Questions are deliberately absent: they are the one part the user has to act
 * on, so they get their own block rather than a bullet list halfway down this
 * one.
 *
 * @param report - The normalized report
 * @returns Plain text for a boxed note
 */
export function renderTurnReport(report: TurnReport): string {
  const lines: string[] = [];

  if (report.summary) {
    lines.push(report.summary);
  }

  if (report.status === "blocked") {
    lines.push("");
    lines.push("The agent reports it is BLOCKED and did not finish.");
  }

  if (report.filesChanged.length > 0) {
    lines.push("");
    lines.push("Files changed");
    for (const file of report.filesChanged) {
      lines.push(`  ${file.path}${file.what ? ` — ${file.what}` : ""}`);
    }
  }

  if (report.decisions.length > 0) {
    lines.push("");
    lines.push("Decisions it made for you");
    for (const decision of report.decisions) {
      lines.push(`  ${decision.decision}${decision.why ? ` (${decision.why})` : ""}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings");
    for (const warning of report.warnings) {
      lines.push(`  ! ${warning}`);
    }
  }

  if (report.notes.length > 0) {
    lines.push("");
    for (const note of report.notes) {
      lines.push(note);
    }
  }

  return lines.join("\n").trim();
}

/**
 * Render the agent's open questions as their own block.
 *
 * @param questions - The questions from a report
 * @returns Plain text, numbered so an answer can refer to one
 */
export function renderQuestions(questions: TurnQuestion[]): string {
  const lines: string[] = [];
  questions.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.question}`);
    if (item.context) {
      lines.push(`   ${item.context}`);
    }
  });
  return lines.join("\n");
}
