import { describe, expect, it } from "bun:test";
import { placeholderKey } from "../lib/keys";
import {
  SYSTEM_PROMPT,
  buildCombinedPrompt,
  buildFollowUpPrompt,
  buildImplementationPrompt,
  buildReconPrompt,
} from "../lib/prompts";
import { normalizeRecon } from "../lib/recon";
import { ADVERTISER_REFERENCE, PUBLISHER_REFERENCE } from "../lib/references";
import { RECON_FIXTURE, VALID_ADVERTISER_KEY, VALID_PUBLISHER_KEY } from "./fixtures";

const DIR = "/srv/app";

describe("buildReconPrompt", () => {
  it("asks read-only for every field the schema requires", () => {
    const prompt = buildReconPrompt("publisher");
    expect(prompt).toContain("READ-ONLY");
    for (const field of [
      "framework",
      "typescript",
      "packageManager",
      "ssr",
      "cmp",
      "walletStack",
      "gtmPresent",
      "entryPoints",
    ]) {
      expect(prompt).toContain(field);
    }
  });

  it("tells the agent to read the code rather than assume", () => {
    const prompt = buildReconPrompt("publisher");
    expect(prompt).toContain("Do not guess");
    expect(prompt).toContain("lockfile");
  });

  it("asks for real conversion events only on the advertiser path", () => {
    expect(buildReconPrompt("advertiser")).toContain("suggestedEvents");
    expect(buildReconPrompt("advertiser")).toContain("Never pad the list");
    expect(buildReconPrompt("publisher")).not.toContain("suggestedEvents");
  });

  it("names the package being installed", () => {
    expect(buildReconPrompt("publisher")).toContain("@specify-sh/sdk");
    expect(buildReconPrompt("advertiser")).toContain("@specify-sh/advertiser");
  });
});

describe("buildImplementationPrompt", () => {
  const recon = normalizeRecon(RECON_FIXTURE, "publisher");

  it("embeds the full integration reference so the agent does not work from memory", () => {
    const prompt = buildImplementationPrompt({ dir: DIR, key: VALID_PUBLISHER_KEY, product: "publisher", recon });
    expect(prompt).toContain(PUBLISHER_REFERENCE);
  });

  it("embeds the advertiser reference for the advertiser SDK", () => {
    const prompt = buildImplementationPrompt({
      dir: DIR,
      key: VALID_ADVERTISER_KEY,
      product: "advertiser",
      recon: normalizeRecon(RECON_FIXTURE, "advertiser"),
    });
    expect(prompt).toContain(ADVERTISER_REFERENCE);
    expect(prompt).not.toContain(PUBLISHER_REFERENCE);
  });

  it("carries the recon findings into the prompt", () => {
    const prompt = buildImplementationPrompt({ dir: DIR, key: VALID_PUBLISHER_KEY, product: "publisher", recon });
    expect(prompt).toContain("Cookiebot");
    expect(prompt).toContain("hooks/use-wallet.ts");
    expect(prompt).toContain("app/providers/specify.tsx");
    expect(prompt).toContain("pnpm add @specify-sh/sdk");
  });

  it("names the target directory and the exact key", () => {
    const prompt = buildImplementationPrompt({ dir: DIR, key: VALID_PUBLISHER_KEY, product: "publisher", recon });
    expect(prompt).toContain(DIR);
    expect(prompt).toContain(VALID_PUBLISHER_KEY);
  });

  it("carries the real edge URLs, not invented ones", () => {
    const publisher = buildImplementationPrompt({ dir: DIR, key: VALID_PUBLISHER_KEY, product: "publisher", recon });
    expect(publisher).toContain("https://spfsrv.com/sdk/v1.js");
    expect(publisher).toContain("connect-src 'self' https://spfsrv.com");

    const advertiser = buildImplementationPrompt({
      dir: DIR,
      key: VALID_ADVERTISER_KEY,
      product: "advertiser",
      recon: null,
    });
    expect(advertiser).toContain("https://spfsrv.com/sdk/advertiser/v1.js");
    expect(advertiser).toContain("connect-src");
  });

  describe("guardrails", () => {
    const prompt = buildImplementationPrompt({ dir: DIR, key: VALID_PUBLISHER_KEY, product: "publisher", recon });

    it("limits the blast radius", () => {
      expect(prompt).toContain("Touch only the files the integration actually requires");
      expect(prompt).toContain("No refactors");
    });

    it("forbids inventing API surface", () => {
      expect(prompt).toContain("Do not invent constructor options");
    });

    it("forbids adding other analytics", () => {
      expect(prompt).toContain("Do not add any other analytics");
    });

    it("forbids fabricating a key", () => {
      expect(prompt).toContain("Never invent, guess, edit");
    });

    it("forbids hardcoding consent and requires a per-page-load gate", () => {
      expect(prompt).toContain("NEVER hardcode consent as granted");
      expect(prompt).toContain("every page load");
      expect(prompt).toContain("consent check stub");
    });

    it("puts identify() in the real wallet-connect callback", () => {
      expect(prompt).toContain("real wallet-connect callback");
      expect(prompt).toContain("skip `identify()` entirely rather than fabricating");
    });

    it("requires the detected package manager", () => {
      expect(prompt).toContain("project's own package manager");
      expect(prompt).toContain("Do not switch package managers");
    });

    it("requires destroy() on SPA teardown", () => {
      expect(prompt).toContain("`destroy()` from the teardown path");
    });

    it("adds the publisher rendering rules", () => {
      expect(prompt).toContain("render nothing at all");
      expect(prompt).toContain("Sponsored");
      expect(prompt).toContain('rel="noopener noreferrer sponsored"');
    });

    it("adds the advertiser event rules instead for the advertiser SDK", () => {
      const advertiser = buildImplementationPrompt({
        dir: DIR,
        key: VALID_ADVERTISER_KEY,
        product: "advertiser",
        recon: null,
      });
      expect(advertiser).toContain("Do not re-implement `page_view`");
      expect(advertiser).toContain("/^[a-z0-9_]{1,64}$/");
      expect(advertiser).not.toContain("Sponsored");
    });
  });

  it("sends the turn's answer to the report schema, not to a closing message", () => {
    const prompt = buildImplementationPrompt({ dir: DIR, key: VALID_PUBLISHER_KEY, product: "publisher", recon });
    expect(prompt).toContain("answering with the JSON report");
    expect(prompt).toContain("filesChanged");
    expect(prompt).toContain("belongs in questions rather than being guessed at");
  });

  it("asks for a prose summary instead when the agent cannot do structured output", () => {
    const prompt = buildImplementationPrompt({
      dir: DIR,
      key: VALID_PUBLISHER_KEY,
      product: "publisher",
      recon,
      report: false,
    });
    expect(prompt).not.toContain("JSON report");
    expect(prompt).toContain("Finish by summarising, in your final message");
    // Every other guardrail is unchanged.
    expect(prompt).toContain("NEVER hardcode consent as granted");
  });

  it("adds a placeholder warning only when the key is a placeholder", () => {
    const real = buildImplementationPrompt({ dir: DIR, key: VALID_PUBLISHER_KEY, product: "publisher", recon });
    expect(real).not.toContain("PLACEHOLDER");

    const placeholder = buildImplementationPrompt({
      dir: DIR,
      key: placeholderKey("publisher"),
      product: "publisher",
      recon,
    });
    expect(placeholder).toContain("PLACEHOLDER");
    expect(placeholder).toContain("TODO");
  });
});

describe("buildCombinedPrompt", () => {
  it("tells the agent to investigate first when there was no recon pass", () => {
    const prompt = buildCombinedPrompt({ dir: DIR, key: VALID_PUBLISHER_KEY, product: "publisher" });
    expect(prompt).toContain("Investigate before you edit");
    expect(prompt).toContain("Only then start editing");
  });

  it("keeps every guardrail the two-pass flow has", () => {
    const prompt = buildCombinedPrompt({ dir: DIR, key: VALID_PUBLISHER_KEY, product: "publisher" });
    expect(prompt).toContain("NEVER hardcode consent as granted");
    expect(prompt).toContain("Touch only the files the integration actually requires");
    expect(prompt).toContain(PUBLISHER_REFERENCE);
  });
});

describe("buildFollowUpPrompt", () => {
  it("carries the developer's words through verbatim", () => {
    const prompt = buildFollowUpPrompt({ kind: "changes", message: "  Put the ad below the fold instead.  " });
    expect(prompt).toContain("Put the ad below the fold instead.");
    expect(prompt).toContain("wants changes");
  });

  it("never resends the reference or the guardrails — the session already holds them", () => {
    const prompt = buildFollowUpPrompt({ kind: "changes", message: "move it" });
    expect(prompt).not.toContain(PUBLISHER_REFERENCE);
    expect(prompt).not.toContain(ADVERTISER_REFERENCE);
    expect(prompt).not.toContain("NEVER hardcode consent as granted");
    expect(prompt.length).toBeLessThan(1200);
  });

  it("reminds the agent that every rule still stands", () => {
    const prompt = buildFollowUpPrompt({ kind: "changes", message: "move it" });
    expect(prompt).toContain("still applies");
    expect(prompt).toContain("same key exactly as given");
    expect(prompt).toContain("change only what this needs");
    expect(prompt).toContain("do not start over");
  });

  it("asks for the same report shape again", () => {
    for (const kind of ["answers", "changes", "verification"] as const) {
      expect(buildFollowUpPrompt({ kind, message: "x" })).toContain("same JSON report");
    }
  });

  it("quotes the questions back when the developer is answering them", () => {
    const prompt = buildFollowUpPrompt({
      kind: "answers",
      message: "Use the sidebar slot.",
      questions: [{ question: "Which slot should the ad go in?" }, { question: "Is the banner the real gate?" }],
    });
    expect(prompt).toContain("1. Which slot should the ad go in?");
    expect(prompt).toContain("2. Is the banner the real gate?");
    expect(prompt).toContain("Use the sidebar slot.");
  });

  it("says who is asking when the wizard's own scan found the gap", () => {
    const prompt = buildFollowUpPrompt({ kind: "verification", message: "- serve is missing. Call `serve(...)`." });
    expect(prompt).toContain("The wizard scanned the project");
    expect(prompt).toContain("serve is missing");
  });
});

describe("SYSTEM_PROMPT", () => {
  it("frames the run as someone else's working codebase", () => {
    expect(SYSTEM_PROMPT).toContain("someone else's working codebase");
    expect(SYSTEM_PROMPT).toContain("one reviewable diff");
  });
});
