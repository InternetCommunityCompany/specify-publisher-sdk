/**
 * The little bit of git the wizard needs.
 *
 * Not to manage the repo — only to answer two questions: is the diff the agent
 * is about to produce going to be reviewable, and what did it come to in the
 * end. Every failure resolves to "not a repo" rather than throwing, because a
 * project without git is a normal thing to integrate into.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface GitStatus {
  /** Tracked or untracked changes present before the wizard ran. */
  dirty: boolean;
  /** Up to a handful of changed paths, for the warning message. */
  dirtyFiles: string[];
  isRepo: boolean;
}

async function git(dir: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run("git", args, { cwd: dir, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Whether the target directory is a git working tree, and whether it is clean.
 *
 * @param dir - Absolute path to the project
 * @returns Repository state
 */
export async function gitStatus(dir: string): Promise<GitStatus> {
  const inside = await git(dir, ["rev-parse", "--is-inside-work-tree"]);
  if (inside?.trim() !== "true") {
    return { dirty: false, dirtyFiles: [], isRepo: false };
  }

  const porcelain = await git(dir, ["status", "--porcelain"]);
  const dirtyFiles = (porcelain ?? "")
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter((line) => line !== "");

  return { dirty: dirtyFiles.length > 0, dirtyFiles, isRepo: true };
}

/**
 * `git diff --stat` over the working tree, including untracked files so a
 * brand-new component the agent added still shows up.
 *
 * @param dir - Absolute path to the project
 * @returns The stat output, or null when there is no repo or no change
 */
export async function gitDiffStat(dir: string): Promise<string | null> {
  const tracked = (await git(dir, ["diff", "--stat", "HEAD"])) ?? (await git(dir, ["diff", "--stat"]));
  const untracked = await git(dir, ["ls-files", "--others", "--exclude-standard"]);

  const parts: string[] = [];
  if (tracked?.trim()) {
    parts.push(tracked.trimEnd());
  }

  const newFiles = (untracked ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (newFiles.length > 0) {
    parts.push(`untracked: ${newFiles.join(", ")}`);
  }

  return parts.length > 0 ? parts.join("\n") : null;
}
