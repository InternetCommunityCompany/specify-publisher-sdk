/**
 * Terminal interaction, behind an interface.
 *
 * The orchestrator only ever talks to `WizardIo`, so its whole decision tree —
 * including every confirmation and every cancellation — is exercisable in a
 * test with a scripted fake and no TTY. `clackIo` is the real implementation
 * and is the only place `@clack/prompts` is imported.
 */

import { cancel, confirm, intro, isCancel, log, note, outro, select, spinner, text } from "@clack/prompts";

/** A cancelled prompt. Every prompt returns this instead of throwing. */
export const CANCELLED = Symbol("cancelled");

/**
 * One entry in a picker. Values are always strings — an id the caller maps
 * back to whatever it selected — which keeps the interface trivial to fake.
 */
export interface SelectChoice {
  hint?: string;
  label: string;
  value: string;
}

export interface WizardSpinner {
  message: (text: string) => void;
  start: (text?: string) => void;
  stop: (text?: string) => void;
}

export interface WizardIo {
  /** Final message on an aborted run. */
  cancel: (message: string) => void;
  confirm: (message: string, initialValue?: boolean) => Promise<boolean | typeof CANCELLED>;
  error: (message: string) => void;
  info: (message: string) => void;
  intro: (message: string) => void;
  /** A boxed block of short lines — plans, verification tables, diff stats. */
  note: (body: string, title?: string) => void;
  outro: (message: string) => void;
  /**
   * Text printed exactly as written, with no box and no re-wrapping. For
   * content whose own layout matters — code blocks in the manual instructions.
   */
  plain: (body: string) => void;
  select: (message: string, choices: SelectChoice[]) => Promise<string | typeof CANCELLED>;
  spinner: () => WizardSpinner;
  success: (message: string) => void;
  /** Free text. An empty reply is returned as an empty string, not cancelled. */
  text: (options: {
    message: string;
    placeholder?: string;
    validate?: (value: string) => string | undefined;
  }) => Promise<string | typeof CANCELLED>;
  warn: (message: string) => void;
}

/** The real terminal implementation, on `@clack/prompts`. */
export function clackIo(): WizardIo {
  return {
    cancel(message: string): void {
      cancel(message);
    },
    async confirm(message: string, initialValue = true): Promise<boolean | typeof CANCELLED> {
      const answer = await confirm({ initialValue, message });
      return isCancel(answer) ? CANCELLED : answer;
    },
    error(message: string): void {
      log.error(message);
    },
    info(message: string): void {
      log.info(message);
    },
    intro(message: string): void {
      intro(message);
    },
    note(body: string, title?: string): void {
      note(body, title);
    },
    outro(message: string): void {
      outro(message);
    },
    plain(body: string): void {
      process.stdout.write(`\n${body}\n\n`);
    },
    async select(message: string, choices: SelectChoice[]): Promise<string | typeof CANCELLED> {
      const answer = await select<string>({
        message,
        options: choices.map((choice) => ({ hint: choice.hint, label: choice.label, value: choice.value })),
      });
      return isCancel(answer) ? CANCELLED : answer;
    },
    spinner(): WizardSpinner {
      const instance = spinner();
      return {
        message: (value: string) => instance.message(value),
        start: (value?: string) => instance.start(value),
        stop: (value?: string) => instance.stop(value),
      };
    },
    success(message: string): void {
      log.success(message);
    },
    async text(options: {
      message: string;
      placeholder?: string;
      validate?: (value: string) => string | undefined;
    }): Promise<string | typeof CANCELLED> {
      const answer = await text({
        defaultValue: "",
        message: options.message,
        placeholder: options.placeholder,
        validate: options.validate ? (value) => options.validate?.(value ?? "") : undefined,
      });
      return isCancel(answer) ? CANCELLED : (answer ?? "");
    },
    warn(message: string): void {
      log.warn(message);
    },
  };
}
