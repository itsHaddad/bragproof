# Decisions

Short records of choices that are not obvious from the code.

| # | Decision | Why |
|---|---|---|
| 1 | No server code at all. Static files and a headers file. | The product's promise is that a log stays on the device. With no endpoint there is nothing to rate-limit, nothing to leak and nothing to trust. |
| 2 | `connect-src 'none'`, and the example report is embedded as a JSON data block instead of fetched. | So the promise is enforced by the browser, not by good behaviour of the script. |
| 3 | Facts, not verdicts. No score. | A score cannot be checked. A quoted line can. Three earlier tools that accused agents of lying were mostly wrong (RETHINK section 2). |
| 4 | The claims rule ("said the tests pass") is measured and switched off. | At most 13 of 30 held (MEASUREMENT). The code stays so the measurement can be re-run after improvements. |
| 5 | `npx` and `bunx` are not reported. | 15 of 15 read by hand ran the project's own tools. |
| 6 | One renderer (`src/ui/h.ts`) produces both the built HTML and the browser DOM. | The example on the first screen is made by the same code as a person's own report, so it cannot drift from it. |
| 7 | Only Claude Code logs are read. | It is the format the public dataset is in, so it is the only one whose rules could be measured. |
| 8 | Display face: Martian Mono, condensed to 75%, one Latin file (38 KB). Text: the system stack. | The subject is a terminal log; a monospace with character says so, condensed so a headline fits a phone. |
| 9 | Palette from a carbon-copy duplicate book: paper and ink, carbon blue, red pencil for marks; at night the carbon sheet with a highlighter. | Chosen from the subject (a record and its duplicate), not from habit. |
| 10 | No motion library. CSS and the Web Animations the browser already has. | Nothing here needs more. |
| 11 | `trusted-types 'none'` is not sent, only `require-trusted-types-for 'script'`. | A browser extension that creates its own policy would log an error on every visit. The built script is tested to contain no policy creation. |
| 12 | No analytics. The goal is counted by replies and issues. | A page that promises to send nothing should not count visitors with a script. |
| 13 | The preview is a separate worker with no route. The public worker config on this branch is static too, and was not deployed. | The old site stays live from `main` until its owner decides. |
