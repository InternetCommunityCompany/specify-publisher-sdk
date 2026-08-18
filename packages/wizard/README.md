# @specify-sh/wizard

Adds a Specify SDK to your codebase, using the coding agent you already have.

```bash
npx @specify-sh/wizard
```

The wizard asks which SDK you are installing and for your key, then drives
whichever coding-agent CLI is on your PATH — Claude Code, Codex, Cursor, Gemini
CLI, opencode, Cline, Goose, Kilo Code — to write the integration.

**It never asks for an API key and never runs a model itself.** Your agent
supplies the model and the auth; Specify supplies the prompt, the current API
reference and the guardrails. There is no inference cost to anyone but you, and
no credentials leave your machine.

## What it does

1. **Asks** which SDK (`@specify-sh/sdk` for publishers, `@specify-sh/advertiser`
   for advertisers) and for your key. You can skip the key and fill it in later.
2. **Checks your working tree.** If it is dirty, or not a git repo at all, it
   warns and asks — the agent is about to edit files, and a clean tree is what
   makes the result reviewable.
3. **Investigates, read-only.** Where the agent supports it, a first pass reads
   your codebase without changing anything and reports back: framework, package
   manager, TypeScript or not, whether you render server-side, which consent
   platform you use and where its decision lands, how you connect wallets, and
   where a shared client belongs.
4. **Shows you the plan** and waits for your confirmation.
5. **Writes the integration**, with the full API reference in the prompt so the
   agent works from the current API rather than its training data.
6. **Reports back, and stays on the line.** Every editing turn answers with a
   structured report — what it changed, file by file; the decisions it made on
   your behalf; anything you need to know about, like a consent stub where you
   have no CMP; and any question it could not settle from the code.
7. **Talks it through with you.** You are then asked what next: finish, request
   changes in your own words, answer its questions, or abort. Changes and
   answers go back as another turn of the *same* conversation, so the agent
   still has everything it read and wrote — it amends its work rather than
   starting over. There is no turn limit; you leave the loop when you are done.
8. **Verifies.** The wizard itself — not the agent — scans your tree for the
   calls that had to be there, prints `git diff --stat`, and tells you what is
   missing. If something required is missing, it offers to hand that straight
   back to the agent as one more change request.

## Options

| Flag | Effect |
| --- | --- |
| `--publisher` / `--advertiser` | Skip the product question |
| `--key <key>` | Your publisher key (`spk_…`) or property key (`adv_…`) |
| `--agent <id>` | Which coding agent to drive, e.g. `claude-code` |
| `--dir <path>` | Project to modify (default: the current directory) |
| `--dry-run` | Investigate and print the plan; change nothing |
| `--yes` | Skip confirmation prompts |
| `--help` | Show usage |

```bash
npx @specify-sh/wizard --publisher --key spk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
npx @specify-sh/wizard --advertiser --dry-run
```

`--yes` is the CI shape: one investigation turn, one implementation turn, then
verification. There is no conversation, because there is nobody to have it with
— if the agent asked questions, they are printed and flagged rather than
answered. `--dry-run` stops after the investigation and changes nothing.

A few agents cannot hold a multi-turn conversation at all (their CLI has no way
to continue an earlier one). The wizard says so, runs the same investigation and
implementation as separate one-shot runs, and skips the follow-up loop: a
follow-up to an agent with no memory of the diff is worse than none.

## If you have no coding agent

Finding no agent is not an error. The wizard prints the complete manual
integration for the SDK you chose — install command, the code to write, the
consent and wallet wiring, the Google Tag Manager alternative with the real
loader URLs, the CSP directives — and exits successfully without touching
anything. Follow it by hand, or install an agent and run the wizard again.

## Guardrails

The prompt is not a wish. It tells the agent, in as many words, to touch only
the files the integration requires; to use the documented API and invent
nothing; to never hardcode consent as granted; to wire the consent gate to your
real consent mechanism on every page load; to put `identify()` in your actual
wallet-connect callback or skip it entirely; to use your package manager; to add
no other analytics; and to never fabricate a key.

It is still an agent editing your code. Read the diff.

## Docs

- Publisher SDK: https://docs.specify.sh/publishing/sdk-reference
- Advertiser analytics SDK: https://docs.specify.sh/advertising/analytics-sdk
