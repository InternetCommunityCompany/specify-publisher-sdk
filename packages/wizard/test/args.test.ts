import { describe, expect, it } from "bun:test";
import { USAGE, parseWizardArgs } from "../lib/args";

const CWD = "/tmp/project";

function parse(argv: string[]) {
  return parseWizardArgs(argv, CWD);
}

describe("parseWizardArgs", () => {
  it("defaults to asking for everything", () => {
    const result = parse([]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.args.product).toBeUndefined();
    expect(result.args.key).toBeUndefined();
    expect(result.args.agent).toBeUndefined();
    expect(result.args.dryRun).toBe(false);
    expect(result.args.yes).toBe(false);
    expect(result.args.help).toBe(false);
    expect(result.args.dir).toBe(CWD);
  });

  it("reads each product flag", () => {
    const publisher = parse(["--publisher"]);
    expect(publisher.ok && publisher.args.product).toBe("publisher");

    const advertiser = parse(["--advertiser"]);
    expect(advertiser.ok && advertiser.args.product).toBe("advertiser");
  });

  it("refuses both product flags at once", () => {
    const result = parse(["--publisher", "--advertiser"]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("not both");
  });

  it("reads the key, agent, yes and dry-run flags", () => {
    const result = parse([
      "--advertiser",
      "--key",
      "adv_1234567890abcdef1234567890abcd",
      "--agent",
      "claude-code",
      "--yes",
      "--dry-run",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.args.key).toBe("adv_1234567890abcdef1234567890abcd");
    expect(result.args.agent).toBe("claude-code");
    expect(result.args.yes).toBe(true);
    expect(result.args.dryRun).toBe(true);
  });

  it("supports the short forms of --yes and --help", () => {
    const result = parse(["-y", "-h"]);
    expect(result.ok && result.args.yes).toBe(true);
    expect(result.ok && result.args.help).toBe(true);
  });

  it("resolves a relative --dir against the working directory", () => {
    const result = parse(["--dir", "apps/web"]);
    expect(result.ok && result.args.dir).toBe("/tmp/project/apps/web");
  });

  it("keeps an absolute --dir as given", () => {
    const result = parse(["--dir", "/srv/site"]);
    expect(result.ok && result.args.dir).toBe("/srv/site");
  });

  it("rejects an empty --dir and an empty --agent", () => {
    expect(parse(["--dir", "   "]).ok).toBe(false);
    expect(parse(["--agent", "  "]).ok).toBe(false);
  });

  it("rejects unknown flags rather than ignoring them", () => {
    const result = parse(["--nope"]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.length).toBeGreaterThan(0);
  });

  it("rejects positional arguments", () => {
    expect(parse(["publisher"]).ok).toBe(false);
  });

  it("documents every flag in the usage text", () => {
    for (const flag of ["--publisher", "--advertiser", "--key", "--agent", "--dir", "--dry-run", "--yes", "--help"]) {
      expect(USAGE).toContain(flag);
    }
    expect(USAGE).toContain("npx @specify-sh/wizard");
  });
});
