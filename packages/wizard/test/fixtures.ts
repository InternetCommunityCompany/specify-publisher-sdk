/**
 * Shared fixtures: a realistic recon payload of the kind an agent returns, and
 * the fake AnyAgent adapter the gateway tests drive.
 */

import type { AgentEvent, RunResult, StdoutAdapter, VersionProbe } from "anyagent-js/types";

export const VALID_PUBLISHER_KEY = "spk_1234567890abcdef1234567890abcd";
export const VALID_ADVERTISER_KEY = "adv_1234567890abcdef1234567890abcd";

/** What a well-behaved editing turn reports back. */
export const REPORT_FIXTURE = {
  decisions: [{ decision: "Put the client in a provider rather than the layout", why: "the app already has one" }],
  filesChanged: [
    { path: "app/providers/specify.tsx", what: "creates the shared client" },
    { path: "app/layout.tsx", what: "mounts the provider" },
  ],
  questions: [],
  status: "complete",
  summary: "Added the provider.",
  warnings: ["No CMP found — added a consent stub with a TODO."],
};

/** What a well-behaved recon run returns for a Next.js app-router project. */
export const RECON_FIXTURE = {
  cmp: {
    confidence: 0.9,
    name: "Cookiebot",
    wireLocation: "app/providers/consent.tsx, in the CookiebotOnAccept handler",
  },
  entryPoints: [
    { file: "app/providers/specify.tsx", why: "where the app already keeps shared client singletons" },
    { file: "app/layout.tsx", why: "wraps every route" },
  ],
  framework: { name: "next", variant: "app-router" },
  gtmPresent: true,
  packageManager: "pnpm",
  ssr: true,
  suggestedEvents: [
    { name: "signup_completed", where: "app/(auth)/signup/actions.ts", why: "the top of the funnel converting" },
    { name: "deposit_started", where: "components/deposit-form.tsx", why: "first money-moving intent" },
  ],
  typescript: true,
  walletStack: { connectionLocation: "hooks/use-wallet.ts, in the wagmi onConnect callback", name: "wagmi" },
};

/**
 * Build a fake AnyAgent stdout adapter that never runs a model.
 *
 * `buildInvocation` points at `/bin/echo`, so the AnyAgent core really does
 * spawn a process and drive the real turn machinery — only the model is fake.
 * `parse` ignores that output and yields the events the test wants.
 *
 * `resume` matters for sessions: AnyAgent refuses to open one on a stdout-mode
 * agent that cannot resume, and a session that can resume still needs a
 * `session` event to learn the handle its second turn continues from. Set
 * `resume: "native"` and the adapter emits one.
 *
 * @param options - The replies, the events to emit, and capability overrides
 * @returns A `StdoutAdapter` usable with `detect({ adapters })`
 */
export function fakeAdapter(options: {
  emit?: AgentEvent[];
  id?: string;
  name?: string;
  readOnly?: "native" | "emulated" | false;
  reply?: string;
  /** One reply per turn, in order; the last one repeats. Overrides `reply`. */
  replies?: string[];
  resume?: "native" | "emulated" | false;
  structuredOutput?: "native" | "emulated" | false;
}): StdoutAdapter {
  const replies = options.replies ?? [options.reply ?? "done"];
  const id = options.id ?? "fake-agent";
  const resume = options.resume ?? false;
  let turn = 0;

  return {
    buildInvocation: () => ({ args: ["ok"], command: "/bin/echo" }),
    capabilities: {
      attachments: false,
      authStatus: false,
      cwd: "native",
      effort: false,
      mcp: false,
      modelListing: false,
      modelSelection: false,
      readOnly: options.readOnly ?? "native",
      resume,
      sessionFork: false,
      streaming: "native",
      structuredOutput: options.structuredOutput ?? "emulated",
      systemPrompt: "native",
      usageStatus: false,
    },
    detection: {},
    meta: { bin: [id], id, name: options.name ?? "Fake Agent" },
    mode: "stdout",
    parse: async function* (source): AsyncGenerator<AgentEvent, RunResult> {
      await source.text();
      const reply = replies[Math.min(turn, replies.length - 1)];
      turn += 1;
      if (resume) {
        yield { sessionId: `${id}-conversation`, type: "session" };
      }
      for (const event of options.emit ?? []) {
        yield event;
      }
      yield { text: reply, type: "text-delta" };
      const result: RunResult = { events: [], raw: { ok: true }, text: reply };
      yield { result, type: "done" };
      return result;
    },
  };
}

/**
 * A version probe that reports the named binaries as installed.
 *
 * @param installed - Binary names to pretend are on PATH
 * @returns A probe for `detect({ probe })`
 */
export function fakeProbe(installed: string[]): VersionProbe {
  return {
    exec: async () => ({ code: 0, stderr: "", stdout: "1.2.3" }),
    which: async (bin: string) => (installed.includes(bin) ? `/usr/local/bin/${bin}` : undefined),
  };
}
