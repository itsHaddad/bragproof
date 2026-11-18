// A report as page parts. The same parts are written into the built page (for the example) and made in the browser
// (for a person's own log). Everything taken from a log enters as a text child and nothing else.

import { GROUPS, groupOf } from "../core/groups.ts";
import type { Finding, Report } from "../core/types.ts";
import { type El, h } from "./h.ts";
import { icon, mark } from "./icons.ts";
import { tape } from "./tape.ts";

const SHOWN = GROUPS.filter((g) => g.id !== "said");
const plural = (n: number, one: string, many: string): string => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

export function readout(report: Report, selected: number): El {
  const f: Finding | undefined = report.findings[selected];
  if (!f) {
    return h(
      "div",
      { class: "readout", id: "readout" },
      h("p", { class: "readout-kind" }, "Nothing found"),
      h("p", { class: "readout-fact" }, `None of the rules matched in ${plural(report.session.steps, "step", "steps")}.`),
      h("p", { class: "muted" }, "That is not proof of a clean session. The rules look for known patterns, and only in what the log recorded."),
    );
  }
  const group = groupOf(f.group);
  return h(
    "div",
    { class: "readout", id: "readout" },
    h("p", { class: "readout-kind" }, mark(group.shape), group.title, h("span", { class: "readout-count num" }, `${selected + 1} of ${report.findings.length}`)),
    h("p", { class: "readout-fact" }, f.fact),
    h("pre", { class: "evidence" }, f.evidence),
    h("p", { class: "muted readout-where num" }, `Step ${f.step.toLocaleString("en-GB")} of ${report.session.steps.toLocaleString("en-GB")}. ${group.means}`),
  );
}

function kinds(report: Report): El {
  const count = (letter: string) => [...report.session.track].filter((c) => c.toLowerCase() === letter).length;
  const rows: [string, string, number][] = [["tall", "commands", count("s")], ["mid", "edits", count("e")], ["low", "reads", count("r")]];
  return h("ul", { class: "kinds" }, ...rows.map(([cls, label, n]) => h("li", {}, h("span", { class: `kind-tick kind-${cls}`, "aria-hidden": "true" }), h("span", { class: "num" }, `${n.toLocaleString("en-GB")} ${label}`))));
}

function counts(report: Report): El {
  return h(
    "ul",
    { class: "counts", "aria-label": "Findings by kind" },
    ...SHOWN.map((g) => {
      const n = report.findings.filter((f) => f.group === g.id).length;
      return h("li", { class: n === 0 ? "count zero" : "count" }, mark(g.shape), h("span", {}, g.short), h("span", { class: "num count-n" }, String(n)));
    }),
  );
}

/** The working panel: where the log came from, what the agent said, the tape, and one finding at a time. */
export function panel(report: Report, label: string, selected: number, example: boolean): El {
  const n = report.findings.length;
  const asked = report.session.askedFirst;
  return h(
    "div",
    { class: "panel-body" },
    h("p", { class: "source" }, h("span", { class: example ? "chip chip-example" : "chip" }, label), h("span", { class: "muted num" }, `${plural(report.session.steps, "step", "steps")}, ${plural(report.session.turns, "request", "requests")}`)),
    report.session.closing ? h("div", { class: "brag" }, h("p", { class: "brag-label muted" }, "What the agent said at the end"), h("p", { class: "brag-text" }, `“${report.session.closing}”`)) : false,
    h("p", { class: "tape-label muted" }, "What the log shows"),
    tape(report, selected),
    kinds(report),
    readout(report, selected),
    h(
      "div",
      { class: n > 1 ? "stepper" : "stepper is-off" },
      h("button", { class: "btn btn-plain", type: "button", "data-step": "-1" }, icon("left"), "Previous"),
      h("input", { class: "scrub", type: "range", id: "scrub", min: 1, max: Math.max(n, 1), value: selected + 1, "aria-label": "Which finding to show" }),
      h("button", { class: "btn btn-plain", type: "button", "data-step": "1" }, "Next", icon("right")),
    ),
    counts(report),
    asked === false ? h("p", { class: "note" }, icon("note"), h("span", {}, "This session ran with permission prompts switched off: the agent did not ask before each step.")) : false,
  );
}

/** Every finding, grouped by kind. Each row can be pressed to show it on the tape. */
export function ledger(report: Report, selected: number): El {
  if (report.findings.length === 0) {
    return h("div", { class: "ledger" }, h("p", { class: "ledger-empty" }, "No rows: no rule matched. The rules that ran are listed on the method page."));
  }
  const groups = SHOWN.map((g) => ({ g, rows: report.findings.map((f, i) => ({ f, i })).filter(({ f }) => f.group === g.id) })).filter(({ rows }) => rows.length > 0);
  return h(
    "div",
    { class: "ledger" },
    ...groups.map(({ g, rows }) =>
      h(
        "section",
        { class: "ledger-group", "data-reveal": "" },
        h("div", { class: "ledger-head" }, h("h3", {}, mark(g.shape), g.title, h("span", { class: "num ledger-n" }, String(rows.length))), h("p", { class: "muted" }, g.means)),
        h(
          "ol",
          { class: "rows" },
          ...rows.map(({ f, i }) =>
            h("li", { "data-pop": "" }, h("button", { class: i === selected ? "row is-on" : "row", type: "button", "data-i": i, "aria-pressed": i === selected ? "true" : "false" }, h("span", { class: "row-step num muted" }, `Step ${f.step.toLocaleString("en-GB")}`), h("span", { class: "row-fact" }, f.fact), h("span", { class: "row-evidence" }, f.evidence))),
          ),
        ),
      ),
    ),
    report.hosts.length > 0 ? h("p", { class: "hosts muted" }, `Hosts named in commands: ${report.hosts.slice(0, 30).join(", ")}${report.hosts.length > 30 ? ` and ${report.hosts.length - 30} more` : ""}.`) : false,
  );
}

/** What makes the report checkable: the id, the rules version, and the command that reproduces it. */
export function fingerprint(report: Report): El {
  return h(
    "dl",
    { class: "fingerprint" },
    h("dt", {}, "Report id"),
    h("dd", { class: "mono", id: "report-id" }, report.id),
    h("dt", {}, "Log, SHA-256"),
    h("dd", { class: "mono" }, report.input.sha256),
    h("dt", {}, "Rules"),
    h("dd", { class: "mono" }, report.rules),
    h("dt", {}, "Lines read"),
    h("dd", { class: "mono" }, `${report.input.lines.toLocaleString("en-GB")}${report.input.skippedLines > 0 ? `, ${report.input.skippedLines.toLocaleString("en-GB")} unreadable and skipped` : ""}`),
  );
}
