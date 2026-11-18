// A report as page parts. The same parts are written into the built page (for the example) and made in the browser
// (for a person's own log). Everything taken from a log enters as a text child and nothing else.

import { GROUPS, groupOf } from "../core/groups.ts";
import type { Finding, Report } from "../core/types.ts";
import { type El, h } from "./h.ts";
import { icon, mark } from "./icons.ts";
import { placed, tape } from "./tape.ts";

const SHOWN = GROUPS.filter((g) => g.id !== "said");
const num = (n: number): string => n.toLocaleString("en-GB");
const plural = (n: number, one: string, many: string): string => `${num(n)} ${n === 1 ? one : many}`;

/** Where a report opens: on a finding about tests or commit checks if there is one, since that is what a closing
 * message most often speaks about; otherwise on the first finding. -1 when there are none. */
export function startAt(report: Report): number {
  const first = report.findings.findIndex((f) => ["test-skipped", "tests-deleted", "failure-masked", "commit-no-verify"].includes(f.rule));
  return first >= 0 ? first : report.findings.length > 0 ? 0 : -1;
}

/** A finding quotes what the agent issued. When the log marks that step as ended with an error (a refusal by the
 * person counts), the action may not have happened, and the report says so beside the finding. */
const ERRORED = "The log marks this step as ended with an error, so it may not have taken effect.";
const errored = (report: Report, f: Finding): boolean => {
  const letter = report.session.track[f.step - 1] ?? "";
  return letter !== "" && letter !== letter.toLowerCase();
};

const KIND: Record<string, string> ={ s: "Command", e: "File edit", r: "File read", f: "Web request", o: "Other tool" };

/** One step of the log: the finding there if a rule matched, otherwise what the step was. */
export function readout(report: Report, selected: number, step: number): El {
  const f: Finding | undefined = report.findings[selected];
  const of = `Step ${num(step)} of ${num(report.session.steps)}`;
  if (f) {
    const group = groupOf(f.group);
    return h(
      "div",
      { class: "readout", id: "readout" },
      h("p", { class: "readout-kind" }, mark(group.shape), group.title, h("span", { class: "readout-count num" }, `${selected + 1} of ${report.findings.length}`)),
      h("p", { class: "readout-fact" }, f.fact),
      h("pre", { class: "evidence" }, f.evidence),
      errored(report, f) ? h("p", { class: "readout-errored" }, ERRORED) : false,
      h("p", { class: "muted readout-where num" }, `${of}. `, h("span", { class: "readout-means" }, group.means)),
    );
  }
  const letter = report.session.track[step - 1] ?? "";
  if (!letter) {
    return h("div", { class: "readout", id: "readout" }, h("p", { class: "readout-kind readout-plain" }, "Nothing found"), h("p", { class: "readout-fact" }, "The log holds no steps."));
  }
  const failed = letter !== letter.toLowerCase();
  return h(
    "div",
    { class: "readout", id: "readout" },
    h("p", { class: "readout-kind readout-plain" }, of, report.findings.length === 0 ? h("span", { class: "readout-count" }, "Nothing found") : false),
    h("p", { class: "readout-fact" }, `${KIND[letter.toLowerCase()] ?? "Step"}${failed ? ", ended with an error" : ""}`),
    h("pre", { class: "evidence" }, report.labels[step - 1] ?? ""),
    h("p", { class: "muted readout-where" }, report.findings.length === 0 ? "No rule matched in this log. That is not proof of a clean session: the rules look for known patterns, and only in what the log recorded." : "No rule matched this step."),
  );
}

function kinds(report: Report): El {
  const count = (letter: string) => [...report.session.track].filter((c) => c.toLowerCase() === letter).length;
  const rows: [string, string, string, number][] = [["tall", "command", "commands", count("s")], ["mid", "edit", "edits", count("e")], ["low", "read", "reads", count("r")]];
  return h("ul", { class: "kinds" }, ...rows.map(([cls, one, many, n]) => h("li", {}, h("span", { class: `kind-tick kind-${cls}`, "aria-hidden": "true" }), h("span", { class: "num" }, plural(n, one, many)))));
}

/** Each kind with its count. A kind that has findings is a button that goes to its first one. */
function counts(report: Report): El {
  return h(
    "ul",
    { class: "counts", "aria-label": "Findings by kind" },
    ...SHOWN.map((g) => {
      const n = report.findings.filter((f) => f.group === g.id).length;
      const inside = [mark(g.shape), h("span", {}, g.short), h("span", { class: "num count-n" }, String(n))];
      return h("li", {}, n === 0 ? h("span", { class: "count zero" }, ...inside) : h("button", { class: "count", type: "button", "data-group": g.id, "aria-label": `${g.title}: ${n}. Show the first.` }, ...inside));
    }),
  );
}

/** What the log records about the agent's own checks and commits, beside what it said. Exit states only: whether
 * the message is true is not judged here (a rule that tried was wrong more often than right). */
function recorded(report: Report): El {
  // The log holds one exit state per command line. Where the check was piped or followed by another command, that
  // state says nothing about the check, so it is not shown as the check's.
  const state = (c: Report["checks"][number]) => (!c.own ? "exit state not recorded (piped, or followed by || true or another command)" : c.failed === true ? "failed" : c.failed === false ? "ended normally" : "no result logged");
  const items = report.checks.map((c) => `${c.command}: ${state(c)}${c.lastLine ? `; last output “${c.lastLine}”` : ""}`);
  if (report.commits.made > 0) items.push(`${plural(report.commits.made, "commit command", "commit commands")}, ${num(report.commits.noVerify)} with --no-verify`);
  // On a phone only the last three lines are shown, to keep the tape in view; the heading says which lines these are.
  const early = Math.max(0, items.length - 3);
  const total = report.checksTotal;
  const kept = report.checks.length;
  return h(
    "div",
    { class: "recorded" },
    h(
      "p",
      { class: "brag-label muted" },
      total > kept ? `What the log records: the last ${kept} of ${num(total)} check runs, in order` : "What the log records, in order",
      early > 0 ? h("span", { class: "recorded-early" }, ` (last 3 of ${items.length} lines)`) : false,
    ),
    items.length === 0
      ? h("p", { class: "recorded-list" }, "No test, lint or build command, and no commit.")
      : h("ol", { class: "recorded-list" }, ...items.map((text, i) => h("li", { class: i < early ? "is-early" : "" }, text))),
    h("p", { class: "recorded-note muted" }, "One exit state is logged per command line, and that is what is shown. Whether the message is true is not judged."),
  );
}

/** The working panel: where the log came from, what the agent said, the tape, and one step at a time. */
export function panel(report: Report, label: string, selected: number, example: boolean): El {
  const n = report.findings.length;
  const steps = report.session.steps;
  const step = report.findings[selected]?.step ?? 1;
  const asked = report.session.askedFirst;
  const leftOff = placed(report).filter((p) => p === null).length;
  return h(
    "div",
    { class: "panel-body" },
    h(
      "div",
      { class: "panel-main" },
      h("p", { class: "source" }, h("span", { class: example ? "chip chip-example" : "chip" }, label), h("span", { class: "muted num" }, `${plural(steps, "step", "steps")}, ${plural(report.session.turns, "request", "requests")}`)),
      report.session.closing ? h("div", { class: "brag" }, h("p", { class: "brag-label muted" }, "What the agent said at the end"), h("p", { class: "brag-text" }, `“${report.session.closing}”`)) : false,
      recorded(report),
      tape(report, selected, step),
      h("div", { class: "kinds-wide" }, kinds(report)),
      readout(report, selected, step),
      h(
        "div",
        { class: steps > 1 ? "stepper" : "stepper is-off" },
        h("button", { class: "btn btn-plain", type: "button", "data-step": "-1", "aria-label": "Previous finding" }, icon("left"), h("span", { class: "stepper-word" }, "Previous")),
        h("input", { class: "scrub", type: "range", id: "scrub", min: 1, max: Math.max(steps, 1), value: step, "aria-label": "Step to show" }),
        h("button", { class: "btn btn-plain", type: "button", "data-step": "1", "aria-label": "Next finding" }, h("span", { class: "stepper-word" }, "Next"), icon("right")),
      ),
    ),
    h(
      "div",
      { class: "panel-extra" },
      h("div", { class: "kinds-narrow" }, kinds(report)),
      counts(report),
      example ? h("p", { class: "note" }, icon("note"), h("span", {}, `A made-up session, written to show the rules. It is busier than real ones: ${plural(n, "finding", "findings")} in ${plural(steps, "step", "steps")}, where most public sessions had none.`)) : false,
      asked === false ? h("p", { class: "note" }, icon("note"), h("span", {}, "The log records permission prompts switched off for at least part of this session.")) : false,
      leftOff > 0 ? h("p", { class: "note" }, icon("note"), h("span", {}, `${plural(leftOff, "finding has", "findings have")} no mark on the tape for lack of room. All are in the list below.`)) : false,
      cut(report) ? h("p", { class: "note note-cut", id: "cut" }, icon("note"), h("span", {}, cut(report))) : false,
    ),
  );
}

/** The sentence that says the read stopped early, or "" when the whole log was read. */
export function cut(report: Report): string {
  const parts: string[] = [];
  if (report.input.stepsNotRead > 0) parts.push(`Only the first ${num(report.session.steps)} steps were read; ${plural(report.input.stepsNotRead, "later step was", "later steps were")} not.`);
  if (report.input.linesCut) parts.push(`Only the first ${num(report.input.lines)} lines were read; the rest of the log was not.`);
  if (report.findingsNotListed > 0) parts.push(`Only the first ${num(report.findings.length)} findings are listed; ${plural(report.findingsNotListed, "more is", "more are")} not.`);
  if (parts.length > 0 && report.input.stepsNotRead === 0 && !report.input.linesCut) return parts.join(" ");
  return parts.length > 0 ? `${parts.join(" ")} Findings in the part not read are missing from this report.` : "";
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
        { class: "ledger-group", id: `group-${g.id}`, "data-reveal": "" },
        h("div", { class: "ledger-head" }, h("h3", {}, mark(g.shape), g.title, h("span", { class: "num ledger-n" }, String(rows.length))), h("p", { class: "muted" }, g.means)),
        h(
          "ol",
          { class: "rows" },
          ...rows.map(({ f, i }) =>
            h("li", { "data-pop": "" }, h("button", { class: i === selected ? "row is-on" : "row", type: "button", "data-i": i, "aria-pressed": i === selected ? "true" : "false" }, h("span", { class: "row-step num muted" }, `Step ${num(f.step)}`), h("span", { class: "row-fact" }, f.fact), h("span", { class: "row-evidence" }, f.evidence), errored(report, f) ? h("span", { class: "row-errored" }, ERRORED) : false)),
          ),
        ),
      ),
    ),
    report.hosts.length > 0 ? h("p", { class: "hosts muted" }, `Hosts named in commands: ${report.hosts.slice(0, 30).join(", ")}${report.hosts.length + report.hostsNotListed > 30 ? ` and ${num(report.hosts.length + report.hostsNotListed - 30)} more` : ""}.`) : false,
  );
}

/** What makes the report checkable: the id, the rules version, and how much of the log was read. */
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
    h("dd", { class: "mono" }, `${num(report.input.lines)}${report.input.skippedLines > 0 ? `, ${num(report.input.skippedLines)} unreadable and skipped` : ""}`, cut(report) ? h("span", { class: "cut-line" }, ` ${cut(report)}`) : false),
  );
}
