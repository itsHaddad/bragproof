# Bragproof

**The diff shows the code. The log shows the rest.**

Bragproof reads a coding agent's session log and lists what a diff cannot show: checks that were skipped, key
files that were opened, code that was brought in, work that was thrown away. Each finding is a fact with the line
that shows it. There is no score and no verdict.

It runs in the browser, on the device. The log is not uploaded: there is nowhere to upload it to.

## Use it

In a browser: open the page and choose a log. Claude Code keeps its logs in `~/.claude/projects/<project>/<session>.jsonl`.

In a terminal, with [Bun](https://bun.sh):

```sh
bun src/cli.ts ~/.claude/projects/my-project/session.jsonl
bun src/cli.ts session.jsonl --json
```

The same file and the same rules give the same report id in both.

## What it looks for

| Kind | Examples |
|---|---|
| Checks skipped | `git commit --no-verify`, hooks switched off, a test command followed by `\|\| true`, a command run outside the sandbox, an edit to the agent's own settings |
| Checks switched off in the code | `@ts-ignore`, `eslint-disable`, a test marked `.skip`, a test file deleted, a CI workflow edited |
| Key files opened | `.env`, SSH keys, cloud credentials, a dump of the environment |
| Code brought in from outside | packages installed by name, `curl … \| sh`, `sudo` |
| Hard to undo | force push, `git reset --hard`, a folder deleted outside the project |
| Hidden text shown to the agent | invisible Unicode in a file or page the agent read, decoded |

The full list, with how often each fires on public sessions, is on the method page and in `src/site/rules-text.ts`.

## How far to trust it

Measured on 283 public Claude Code sessions (SWE-chat, seeded sample):

- 78 sessions (27.6%) had at least one finding; 28 (9.9%) had one that no diff can show. 25 of the 78 include a
  neutral finding (a CI workflow or settings file touched), which is counted in a kind of its own.
- Of 40 findings about checks and keys read by hand, 39 were what they said. Of 30 others, 26 were; the three
  causes were fixed. The reading was done on the first version of the rules and the current counts were not
  read again. How much the rules miss was not measured, and 11 of the 28 rules never fired on real sessions.
- A rule for "said the tests pass, the log does not show it" held in at most 13 of 30. It is switched off.

The reading by hand was done by the builder, a language model. Details and limits: [docs/MEASUREMENT.md](docs/MEASUREMENT.md).

**A clean report is not proof of a clean session.** The rules match known patterns in what the log recorded. An
agent can work around them, and the log is a file the agent could change. See [SECURITY.md](SECURITY.md).

Only Claude Code logs are read for now. Other formats are refused with a message.

## Why it was rebuilt

The earlier Bragproof (signed run reports for MCP servers) stays on `main` until its owner decides. The reasoning
for this version, the candidates that lost and the test that could have killed it are in [docs/RETHINK.md](docs/RETHINK.md).

## Development

```sh
bun install
bun run check      # lint, types, build, tests
```

One module per area, no file over 250 lines. The site is static: `bun run build` writes `dist/`. The design gate's
browser measurements run on GitHub Actions (`.github/workflows/walk.yml`), the public-data measurement in
`.github/workflows/measure.yml`.

MIT. Public-session figures come from the SWE-chat dataset (Baumann et al., 2026), used under ODC-BY.
