# Design gate, 18 November 2026

Address judged: https://bragproof-rethink-preview.itshaddad.workers.dev
Runner: workflow `walk`, run 44415210452, commit `aab7184` (the address served the same commit). 288 checks, 0 failed.
A later commit changed two style rules (table cell padding on a phone, tab labels on one line); the runner was started
again for it and its result is in the pull request's checks.

**Scope.** Routes: `/`, `/method/`, the not-found page. States of `/`: example (first visit), a busy log (full),
a log with one finding (first entry), a clean log (empty), a hostile log, a wrong file (refusal), the paste field
with a wrong input (error). Each at 390 and 1280, light and dark: 36 screenshots, plus 320 px and motion frames.
One language. Nothing is stored, so there is no returning-visitor state.

| # | Line | Result | Evidence |
|---|---|---|---|
| 1 | Subject visible in the first screen | PASS | The working panel (tape, one finding, stepper) is the hero. At 390 px 67% of it and the whole tape (bottom 706) are inside 844 (runner `firstScreen`). |
| 2 | One primary action in the first 844 px | PASS | "Choose a log file": bottom 373, 44 px high, one primary in the view (runner). |
| 3 | Display type | PASS | h1 37.1 px at 390 (2.3x body), 72 px at 1280 (4.5x), Martian Mono self-hosted, tracking -0.035em (runner `system`). |
| 4 | Tokens, three radii, one shadow | PASS | Radii 6 px, 16 px, pill; no shadow at rest (runner). Colours only from `src/site/tokens.ts`; the favicon file carries its own three. |
| 5 | Page uses its width | PASS | 5fr/7fr splits on every section of both pages; no running text wider than 75ch (runner, every state). |
| 6 | Rhythm and alignment | PASS | One section token; header, headings and footer share x=32 at 1280 and x=17 at 390 (runner). |
| 7 | Both themes designed | PASS | `tests/contrast.test.ts` (text 4.5:1, borders and focus 3:1, both themes); dark has its own accent (highlighter yellow). Screenshots of every state in both. |
| 8 | One load moment | PASS | At least 4 animations running at 200 ms; headline, lead and button opaque at 1 s; all settled by 1.7 s (runner `motion`, both sizes). |
| 9 | Controls answer hover, press, focus | PASS, one limit | Buttons, tabs, rows and links have colour hover behind a pointer check, press scale or colour, and a focus ring (runner keyboard walk). The range input keeps the browser's own hover and press look. |
| 10 | Something alive on returning screens | PASS | The tape with its stepper and range on `/`, in every state including clean and one finding. `/method/` is a one-time read; its bars fill once. |
| 11 | Data arrives animated once; final values in the HTML | PASS | The example report is in the built HTML (test "the example on the first screen"); ticks wipe, marks pop, bars fill once. |
| 12 | Reduced motion | PASS | Emulated on every page and state at 320 px: 0 running animations, nothing hidden (runner). The first pass failed here and was fixed. |
| 13 | Layout shift | PASS | 0 on `/` (through a step press) and `/method/` on the phone profile; only transform, opacity, clip-path and colour animated (runner). |
| 14 | Motion does not slow the task | PASS | No animation on typing; stepping swaps the readout in 150 ms; no loops. |
| 15 | No garbage tells | PASS | Gone through 1 to 24. Counted: no more than three sibling boxes of one style in a column (ledger is one surface with rows); the form is one field. Tell 14: icons are authored SVG, one stroke weight. Tell 17: left-aligned throughout. |
| 16 | Keyboard | PASS | Skip link first; Tab reaches choose, paste, range, rows, copy; every stop ringed and on screen; arrow keys on the range, Enter on a row, Space on paste (runner `keyboard`). The error is beside the field with `role="alert"`. |
| 17 | Sizes | PASS | No text under 14 px and every control at least 44 px at 390, all states; no sideways scroll at 390 or 320 (runner). |
| 18 | Not colour alone | PASS | Each kind of finding has its own shape; the ledger and counts are the text form of the tape; bars sit in tables. |
| 19 | Weight | PASS | `/`: 50.8 KB pages, styles and script on the wire, one typeface file 38.9 KB, largest paint 772 ms on the phone profile, one host. `/method/`: 41.8 KB, 792 ms. |
| 20 | Console and network | PASS | No page error, console error, failed request, policy violation or dialog on any page or state (runner); console read first in the walked browser tab, clean after two header fixes. |
| 21 | Beside the reference bar | PASS, with gaps named | Seen in the same tab: the reference's landing at 1280 light and 390 dark, its rankings page at 1280 light. Weakest screen here is `/method/`. Sections with a live visual: `/` 4 of 4, `/method/` 2 of 4 (two are tables or text). Gaps: the reference's hero is an ambient, pointer-reactive scene and its charts read values on hover; here the hero is a working tool and the bars are static. Type, rhythm and hairlines match the bar. Not captured: the reference's data page at 390. |
| 22 | Seen in motion | PASS | `motion-390-during-load`, `-after-load`, `-mid-step`, `-mid-read` and the same at 1280 (runner artifacts). |
| 23 | Real path at 390 as a visitor | PASS | In the browser tab: typed a wrong input (refused in words, example kept), typed a log holding script tags and an instruction aimed at an agent (shown as text, one finding, no element made), stepped through findings. |
| 24 | Recorded corrections | PASS | Under 240 words outside the report (test); no "never", "ever", "forever" or guarantees (test); public text does not name how it is built beyond what a person needs; plurals fixed after "1 commands" was seen on the walk. |
| 25 | One grid and chrome | PASS | Same header, footer, fonts and controls on all three pages; left edges equal (runner); `scrollbar-gutter: stable`. |
| 26 | Everything in the page's language | PASS | The file input is hidden behind a labelled button and a status line; no browser validation bubble is used. |
| 27 | Wording reads as written by a person | PASS | "1 step, 1 request", "1 finding.", sizes named in megabytes, numbers in one locale, each message beside what it is about. |

Not done: the independent Designer pass the skill asks for before any public link. This run was by the builder.
