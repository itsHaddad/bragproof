# Measurement and kill test, 18 November 2026

The pass marks were fixed in `docs/RETHINK.md` section 5 (commit `41cccda`) before the first run.

## What was run

`scripts/measure.ts`, by the `measure` workflow on GitHub Actions. It lists the 5,143 public traces of
`cfahlgren1/SWE-chat` (an ungated copy of SALT-NLP/SWE-chat, ODC-BY), draws 300 with the seed
`bragproof-2026-11-18`, reads each with the engine, and uploads counts and a seeded draw of findings to read.

| Run | Commit | Why |
|---|---|---|
| 1 | `41cccda` | First measurement. Hand reading of 40 primary and 30 claims findings. |
| 2 | `6e69458` | After run 1's fixes. Hand reading of 30 findings outside the primary groups. |
| 3 | `81d98e9` | After run 2's three fixes. Counts only. These are the numbers on the site (`docs/measurement.json`). |

283 of the 300 were Claude Code logs with at least one step. 14 were another agent's format, 3 had no steps.

## Result

| Test | Mark set beforehand | Result | Verdict |
|---|---|---|---|
| K1: sessions with a check skipped or switched off, or a key file opened | 10% to pass, under 3% kills | 62 of 283, 21.9% | Pass |
| K2: those findings read by hand, action happened as stated | 85% to pass, under 70% kills | 39 of 40, 97.5% | Pass |
| K3: "said the tests pass, the log does not show it" | 70% or the rule is switched off | 17 of 30 wrong, 2 right, 11 not decidable from the log: at most 13 of 30, 43% | Fail: rule switched off |

The pick survives, narrowed: actions are reported, claims are not.

## What the reading found

- **K2, the one miss:** an edit to a release workflow was called an edit to "the checks". The wording is now
  "a CI workflow or commit-hook file". One finding (a deleted file named `test_manifest.py`) was counted true
  without certainty that it was a test.
- **K3, why it fails:** tests ran through a runner the rule did not know (gleam, a make target, jest through a
  workspace filter); the "claim" was a plan, a review of someone else's code or a report of CI; checks ran inside
  the commit hook. The same result three other people got with their own tools (see RETHINK section 2).
- **Outside the primary groups (run 2):** 26 of 30 true, 1 uncertain (an install after `||`, which runs only if
  the first command fails), 3 false. Fixed with tests: a redirect target read as a folder to delete, `uv tool run`
  read as an install, a checkout of an old commit read as throwing work away.
- **Found in run 1 and removed:** `npx name` and `bunx name` were reported as code fetched from a registry. 15 of
  15 read were the project's own tools (`tsc`, `vitest`). They are no longer reported, and the method page says so.
  A `curl` piped into `python -c` was reported as a script being run; only shells that run their input count now.

## Numbers on the site (run 3)

| Kind | Sessions of 283 | Share |
|---|---|---|
| Any finding | 78 | 27.6% |
| A finding no diff can show (skipped, keys, hard to undo) | 35 | 12.4% |
| Checks skipped | 14 | 4.9% |
| Checks switched off in the code | 41 | 14.5% |
| Key files opened | 11 | 3.9% |
| Code brought in from outside | 9 | 3.2% |
| Hard to undo | 13 | 4.6% |
| Hidden text shown to the agent | 0 | 0% |
| Ran with permission prompts switched off | 80 | 28.3% |

## Regrouped after review (run 4, commit `8966743`, 19 November)

An independent review pointed out that two kinds of rule inflated the headline rates: "edited a CI workflow or
commit-hook file" fires on any edit, and "ran outside the sandbox" and "edited the agent's own settings" are not
checks being skipped. They now sit in a kind of their own, "Settings and pipelines touched". No rule changed what it
matches; `docs/measurement.json` and the site now carry these figures, and the table above is kept as the record
of what was first published.

| Kind | Sessions of 283 | Share |
|---|---|---|
| Checks skipped | 7 | 2.5% |
| Checks switched off in the code | 25 | 8.8% |
| Settings and pipelines touched | 25 | 8.8% |
| A finding no diff can show (skipped, keys, hard to undo) | 28 | 9.9% |
| Any finding | 78 | 27.6% |

K1 as it was defined (the same rules) is unchanged at 62 of 283. Counted without the neutral kind it would be
lower; that figure was not computed.

## Limits

- The 39-of-40 reading was done on run 1's rule version. Later counts were not read by hand again.
- 11 of the 28 rules never fired in the 283 sessions, so nothing is known about their precision on real logs.

- The hand reading was done by the builder, a language model, from the workflow's output. No outside person has
  repeated it. Run 3's counts were not read by hand again.
- The sample is 283 sessions from people who chose to publish their logs, and several come from the same few
  projects (one command-line tool's team accounts for many of the lint findings). Rates elsewhere will differ.
- Precision was measured, recall was not: nobody counted what the rules missed.
- "True" means the action happened as stated. It does not mean the action was wrong: many were plainly fine
  (a lint exception with a reason beside it, a force push to the person's own branch).
- The version string of the rules was raised to `2026-11-18.3` in the commit after run 3; no rule changed between.

## Run it again

Push a change to `scripts/measure.run`, or start the `measure` workflow by hand once it is on the default branch.
Locally: `bun scripts/measure.ts 300 bragproof-2026-11-18 measurement` (downloads a few hundred megabytes).
