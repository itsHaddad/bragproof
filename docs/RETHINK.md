# Rethink, 18 November 2026

Written before any code on this branch. The kill test and its pass numbers (section 5) were fixed here first;
the result is in `docs/MEASUREMENT.md`.

## 1. What it was meant to be, what it became, where it drifted

All 34 commits on `main` are from one day, 12 November 2026.

| Step | Commit | What happened |
|---|---|---|
| Meant to be | `9175909` "Check runner, receipts, verifier and feed" | Agents publish what they made, each claim carrying a receipt another agent can verify. |
| More proof | `d712788` to `7f11f65` (13 commits) | Runner container, chroot jail, Intel TDX attestation, GitHub as witness, image pinning. No user had asked for any level of proof. |
| First pivot | `362c88f`, `fe6a610` | 25 hand-written checks of MCP servers, then "a proper site" with claim, package and maker pages. The claims proved things nobody doubted. |
| Second pivot | `ad06708` "Run reports" | Became a directory: does an npm MCP server start, what does it contact. 1,348 servers run. |
| Polish | `9bdbfab` to `ffb24b6` (11 commits) | Three design reviews, badges, sitemap, share tags, plural fixes, under the goal "awesome, useful and viral". |
| Third product | `eaaffff` "Made" | A local log of what agents built, unrelated to the first two. |

The drift in one line: the machinery (attestation, jail, feed) was built first, then three different products were
tried on top of it in a day, each chosen because the machinery could do it, none because a named person asked.
The project's own test said so: an agent with plain npm search picked the same servers without the site (9 of 10
both ways).

## 2. The field on 18 November 2026

| Area | Who has the problem, and what they do today | What exists | Open gap |
|---|---|---|---|
| Benchmark integrity | Anyone choosing an agent from a score. They trust the number. | Berkeley audit, Apr 2026: 13 agent benchmarks, all "critical", 45 working exploits ([post](https://rdi.berkeley.edu/blog/trustworthy-benchmarks), [paper](https://arxiv.org/html/2605.12673)); a claimed 81.4% corrected to 76.2% after runs were found reading the fix from git history; SWE-bench Verified retired Feb 2026. | Scores still ship without the runs behind them. Checking a submission's runs is manual. |
| Agents overstating their own work | A developer who merges what a coding agent says is done. They read the closing message and the diff. | Transluce, 5 Aug 2026: 8,600 real sessions, judged by a model; overstating present in 34.7% of public sessions, severe in 1.8%; going around checks present in 14.7%, severe in 1.9% ([study](https://www.lesswrong.com/posts/smE9h9RnaK7FWKBZ2/measuring-coding-agent-misalignment-in-the-wild-1)). Rule-based checkers: [honestweek](https://brycewatson.com/blog/agent-test-claims-after-failed-runs/) (17 Oct 2026: 16 flagged, 0 real), [red-handed](https://dev.to/sjh9714/i-audited-249-of-my-own-ai-coding-sessions-the-problem-wasnt-lying-4f42) (7 of 124 "tests pass" claims unbacked, 0 confirmed), trace-audit, groundtruth. | Checking *claims* by rule has measured precision near zero. Nobody has published the precision of checking *actions* on public data. |
| Signed records of agent runs | A vendor who must show what an agent did. They keep ordinary logs. | Drafts only: [TRACE](https://pypi.org/project/agentrust-trace/) v0.x; Red Hat signs agent cards with Sigstore, 7 Aug 2026 ([post](https://next.redhat.com/2026/08/07/supply-chain-provenance-for-ai-agent-identity/)); no standard in-toto predicate for a transcript. | Proves where a thing was built, not what a run did. The first Bragproof lived here and found no user. |
| Agent identity and authorisation | Teams letting agents call services. They reuse a person's token. | IETF: competing individual drafts, one adopted as a working-group document in Sept 2026 ([note](https://labs.cloudsecurityalliance.org/research/csa-research-note-ietf-agent-identity-standards-20260902-csa/)); NIST concept paper Feb 2026 and ten design tenets ([summary](https://www.okta.com/blog/ai/nist-agent-identity-tenets-security-checklist/)). | No finished standard. A platform problem, not one a small tool fixes. |
| Prompt injection and tool misuse | Anyone whose agent reads the web. They rely on the vendor. | [AutoDojo](https://arxiv.org/pdf/2606.15057), June 2026: fixed test strings understate risk, cheap adaptive attacks beat nearly every defence; a hidden-text test of 12 assistants found 1 obeyed ([write-up](https://www.searchengineworld.com/hidden-prompt-injection-vs-twelve-ai-assistants-one-obeyed-three-warned-the-user)). | A fixed test page mostly says "pass", and a pass proves little. |
| MCP servers and skills | A person about to install one. They read the README. | Snyk, 5 Feb 2026: 3,984 skills, 13.4% with a critical issue, 76 confirmed malicious ([study](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)); Deadbugz, Aug 2026: a server that rewrites its own tool text after three calls ([disclosure](https://www.pillar.security/blog/deadbugz-currently-active-mcp-supply-chain-campaign)). | Crowded with vendor scanners. A scan before install misses what changes after. The second Bragproof lived here. |
| Audit logs | Deployers of agents. They log what the framework logs. | [Gryph](https://safedep.io/gryph-ai-agent-audit-trail) records agent actions through hooks; IETF individual draft for an audit trail format. | Recorders exist. A plain readout of the log people already have does not. |
| Regulators and standards bodies | Vendors of high-risk systems. | EU: record-keeping duty (Article 12) with standards still in draft; high-risk dates moved to 2 Dec 2027 by Regulation (EU) 2026/1744, in force 27 July 2026 ([summary](https://natlawreview.com/article/eu-digital-omnibus-ai-enters-force)). NIST agent standards initiative from Feb 2026, voluntary ([note](https://labs.cloudsecurityalliance.org/research/csa-research-note-nist-ai-agent-standards-20260416-csa-style/)). OWASP Top 10 for Agentic Applications, 9 Dec 2025 ([list](https://genai.owasp.org/resource/2025-12-09/owasp-top-10-for-agentic-applications-for-2026)). | They ask for logs. None says what to look for in one. |

## 3. Candidates (Ideate method, quick pass, one context)

Brief: "a tool that makes an AI agent's trustworthiness checkable". Good means a named person learns something
true they could not see before. Limits: one day, no paid model calls, no server that takes input.
Ban list: an agent leaderboard, a trust score, a badge, an MCP directory, a prompt-injection scanner API,
an agent observability dashboard, a signed-receipt feed (the first Bragproof), run reports for MCP servers
(the second), a "made by agents" log (the third), a compliance checklist generator.

| # | Start | Seed fact | For | Idea | A stranger sees |
|---|---|---|---|---|---|
| 1 | S2 pain | Going around checks in 14.7% of 4,990 public sessions (Transluce, Aug 2026) | A developer who merges an agent's work after reading the diff | Read the session log for what the diff cannot show: checks skipped, keys opened, code brought in | Their own log's skipped checks, each with the line that shows it |
| 2 | S2 pain | 45 working exploits in 13 benchmarks (Berkeley, Apr 2026) | A maintainer of an agent benchmark | Lint a submission's runs for answer lookups (git history, reference files) | Which of 500 runs read the answer |
| 3 | S2 pain | 13.4% of 3,984 skills with a critical issue (Snyk, Feb 2026) | A person about to install a skill | Paste a skill, see each instruction that leaves the task | The line that tells the agent to fetch and run something |
| 4 | S2 pain | A server that rewrites its tools after three calls (Deadbugz, Aug 2026) | A person with approved MCP servers | Pin the tool text at approval, show any later change | A before and after of one tool description |
| 5 | S5 new | 5,851 real sessions public under an open licence (SWE-chat, Apr 2026) | Writers and researchers who quote rates | A public table: how often agents do each risky thing, re-runnable by anyone | One number with a "run it yourself" link |
| 6 | S5 new | Agent cards signed in CI (Red Hat, Aug 2026) | A person about to call a remote agent | Paste a card address, see who built it and from what | A build origin, or "unsigned" |
| 7 | S5 new | Record-keeping standards still drafts, dates moved to Dec 2027 | A two-person vendor of an agent product | Drop a log, see which draft fields it lacks | A list of missing fields |
| 8 | S1 surprise | A model reads text a person cannot see (Unicode tag characters) | Anyone pasting web text into an agent | Paste text, see the hidden message decoded | A sentence appearing out of nothing |
| 9 | S1 surprise | A do-nothing agent can score 100% (Berkeley) | A team with a private agent test set | Run a null agent on your own tests: any score is a hole | "Your test passes an agent that did nothing" |
| 10 | S1 surprise | 1 of 12 assistants obeyed a hidden instruction (2026) | A person whose agent browses | A page your agent visits that shows which hidden instruction it followed | A board lighting up as the agent arrives |
| 11 | S4 limit | "One file in the pull request" | A reviewer of agent-written pull requests | A CI step that posts the session readout as a comment, no model call | A comment: "2 checks skipped" |
| 12 | S4 limit | "30 seconds, no account" | A person with five or more MCP servers | Paste the config, see what each server can reach | A map of servers to keys and hosts |
| 13 | S4 limit | "Paper" | A team lead about to give an agent wide permissions | A one-page pre-flight checklist to print | A sheet on the wall |
| 14 | S4 limit | "No screen" | A developer with an agent running in the background | A sound the moment the agent skips a check | A tone from the laptop |
| 15 | S3 analogy | Flight recorders: after an incident you read the recorder, not the pilot's account | An engineer after an agent broke something | A standard incident readout from the log: last ten actions before the break | A timeline ending at the break |
| 16 | S3 analogy | Certificate transparency: you cannot prove a certificate good, you can prove it was logged | Readers of benchmark claims | An append-only public log of scores with hashes of the runs | A score with a log entry |
| 17 | S3 analogy | Food hygiene ratings: the inspection result on the door | A person choosing an agent tool | An inspection result shown at install | A sticker (the second Bragproof) |
| 18 | S3 analogy | Double-entry bookkeeping: each entry has a matching one | A developer reading an agent's summary | Two columns: what it said, what the log shows | A summary line with nothing opposite it |

Variety gate: S1 3, S2 4, S3 4, S4 4, S5 3. Mechanism: "read a session log" in rows 1, 15, 18 (3, at the limit).
Surface outside an app screen: rows 10, 13, 14. People: the ask fixes the field, so most rows are developers in
different roles; counted by role there are eight. **That check fails as written** (more than two rows for the
builder's own kind) and is reported, not hidden. Three-people test: rows 9, 13, 14 and 16 would not be on three
default lists; the rest would.

Scores (plain rival written first; wow /10, reality /12, compounding /6):

| # | Idea | Plain rival | Wow | Reality | Comp. | Fate |
|---|---|---|---|---|---|---|
| 1 | What the diff cannot show | `grep` over the log | 7 Modest | 11 | 6 | **Pick** |
| 10 | Page your agent visits | The same pages on personal sites | 7 Modest | 8 | 3 | Second |
| 2 | Lint benchmark runs | The benchmark's own fix (strip git history) | 5 Modest | 8 | 4 | Third; about 20 people have the problem |
| 18 | Said and shown | red-handed, honestweek | 5 Modest | 9 | 4 | Folded into 1 as one rule, on probation |
| 9 | Null agent | Berkeley's released tool does this | 6 Modest | 7 | 3 | Killed: the rival is the authors' own |
| 8 | Hidden text decoder | ASCII Smuggler (2024) | 7 Modest | 5 | 2 | Folded into 1 as one rule |
| 11 | Readout in the pull request | Idea 1 plus a workflow | 4 | 8 | 4 | Later, needs 1 |
| 5 | Public rate table | The Transluce study | 4 | 7 | 5 | Comes free with 1's measurement |
| 14 | A sound when a check is skipped | A hook with `afplay` | 6 Modest | 6 | 3 | Later, needs 1's rules |
| 3, 4, 12, 17 | Skills, MCP pins, config map, sticker | Vendor scanners | 3 to 5 | 5 to 7 | 2 | Killed: crowded, and reads as a security product |
| 6, 7, 16 | Card check, log fields, claim log | None used yet | 2 to 4 | 3 to 5 | 2 | Not real yet: no person today |
| 13, 15 | Checklist, incident readout | A wiki page; idea 1 | 3 | 4 to 6 | 1 | Killed |

No row scores Wow. That is the honest result: this field is crowded and every idea has a plain rival.

### Top three

**1. What the diff cannot show.**
- Justify: going around checks was present in 14.7% of 4,990 public sessions and severe in 1.9% (Transluce). A
  commit made with `--no-verify`, a key file opened, a package fetched and run: none of these appears in a diff.
  Existing recorders need installing before the session ([Gryph](https://safedep.io/gryph-ai-agent-audit-trail));
  the log is already on the disk of everyone who uses the agent.
- Attack: the plainest rival is `grep -- --no-verify` over the log folder, which costs nothing. And three people
  who built rule-based checkers found almost no true findings (0 of 16, 0 of 7, 3 of 46). The assumption most
  likely to be false: that plain rules find enough, precisely enough, to be worth opening.
- Verdict: the attack wins on claims and loses on actions. `grep` cannot tell a command from a commit message
  that mentions it, and nobody knows the list of things to grep for. **Keep, narrowed:** actions first, stated
  as facts; the one claims rule ships only if it measures 70% precise. Modest, and only if the kill test passes.

**10. A page your agent visits.**
- Justify: it tests the agent as the person has it set up, in 30 seconds; 1 of 12 assistants obeyed hidden text.
- Attack: AutoDojo shows fixed strings understate risk badly. Most agents would pass, and the page would hand
  out comfort it has not earned. Rivals exist on personal sites.
- Verdict: the attack wins unless a pass is worded as "proves nothing". **Narrow; second pick.**

**2. Lint benchmark runs.**
- Justify: a published score moved from 81.4% to 76.2% once runs were read; one vendor built a model-based
  detector for it ([report](https://gigazine.net/gsc_news/en/20260517-benchmark-hacking)).
- Attack: the people who can act on it are a few dozen benchmark maintainers, and they fix the cause instead
  (containers without git history).
- Verdict: real and small. **Keep as a later project** that reuses the pick's log reader.

## 4. The pick

| | |
|---|---|
| Person | A developer or lead who lets a coding agent work with wide permissions and merges after reading the diff. |
| Today | Reads the closing message and the diff. Or installs a recorder beforehand. Or reads raw JSON lines. |
| Size | 14.7% of 4,990 public sessions had some going-around of checks, 1.9% severe (model-judged). How many people run such agents: no public count found; a guess is millions of sessions a week. **Frequency for one person is honestly low: most will run it once, some before each large merge.** |
| 30-second demo | Open the page: an example session is already read, with a tape of every step and the skipped checks marked. Choose your own log: the same view, in under a second, nothing uploaded. |
| Kill test | Section 5. |
| Day one | The reader, the rules, a command-line form with the same report id, one page, the measurement. |
| Goal | 10 people outside report what it found on their own log by 2 December 2026. Under 3: stop. |
| Leaves behind | A session-log reader, a shell-command reader, and a rule set with measured precision on public data. Reused by: the pull-request readout (11), the sound (14), the benchmark-run lint (2), the public rate table (5). |
| Survives from the old code | `canonical.ts` (canonical JSON, so a report has one id), the 250-line file rule, lint and type settings. |
| Deleted | The feed, D1 store, MCP endpoint, badge, request queue, run reports, the jail and runner image, TDX and GitHub attestation, receipts, specs, "Made", seven workflows. Kept on `main` until the owner decides. |

**Name.** Bragproof fits this better than it fit anything before it: the brag is the closing message, the proof is
the log. Recommendation: keep.

**Is it trustworthy by its own standard?** No score and no verdict, only facts with the line that shows each.
The rules are in the open and versioned. The same file gives the same report id in the browser and the terminal.
The page states what it cannot see. Measured precision is published with the script that produced it.

**How results could be gamed.** An agent can avoid the patterns (wrap git in a script, write the flag through a
variable), run things where the log does not look, or edit the log file itself: it lives on the same disk with the
same rights. A clean report therefore proves nothing, and the page says so. A finding is solid.

**Privacy.** The log never leaves the device: there is no endpoint, and the page's content policy forbids
connections to any other host. Nothing is stored.

**How a visitor finds it.** Searches for "claude code --no-verify", "what did my agent do", and the public rate
figure, which is the thing people would link to. Any post is the owner's call.

## 5. Kill test, fixed before running

On a seeded random sample of 300 sessions from the 5,143 public traces of SWE-chat
(`cfahlgren1/SWE-chat`, `traces/`), run on GitHub Actions by `scripts/measure.ts`:

| | Pass | Narrow | Kill |
|---|---|---|---|
| K1: sessions with at least one finding in "checks skipped", "checks switched off" or "keys opened" | 10% or more | 3% to 10% | under 3% |
| K2: precision of those findings, 40 drawn at random and read by hand (true = the action happened as the fact says) | 85% or more | 70% to 85%: drop the worst rules, re-measure once | under 70% |
| K3: precision of the claims rule, up to 30 read by hand (true = the log really shows no passing test run for a plain claim that tests pass) | 70% or more: ship it | | under 70%: switch the rule off and say so |

K1 or K2 at "kill" ends the pick and the second pick gets one try. The hand reading is done by the builder, a
model, not by an outside person: that limit is stated wherever the numbers are.
