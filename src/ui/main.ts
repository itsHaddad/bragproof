// The page's script. It reads a log the person chooses, on their device, and shows the report.
// It makes no network request: the page's content policy forbids it, and there is nothing to send to.

import { analyze } from "../core/analyze.ts";
import { LIMITS } from "../core/parse.ts";
import { quote } from "../core/text.ts";
import { NotALog, type Report } from "../core/types.ts";
import { toDom } from "./h.ts";
import { reduced, replay, reveals } from "./motion.ts";
import { cursorAt, stepAt } from "./tape.ts";
import { cut, fingerprint, ledger, panel, readout, startAt } from "./view.ts";

const $ = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const panelEl = $("panel");
const ledgerEl = $("ledger");
const printEl = $("fingerprint");
const status = $("status");
const errorEl = $("error");
const fileInput = $<HTMLInputElement>("file");
const pasteBox = $("paste");
const pasteText = $<HTMLTextAreaElement>("paste-text");
const backButton = $("back");

let report: Report | null = null;
let example: Report | null = null;
/** The finding on show, or -1 when the step on show has none. */
let selected = -1;
let step = 1;

function fill(el: HTMLElement | null, node: Node): void {
  if (el) el.replaceChildren(node);
}

function show(next: Report, name: string, fresh: boolean): void {
  report = next;
  selected = startAt(next);
  step = next.findings[selected]?.step ?? 1;
  const isExample = next === example;
  fill(panelEl, toDom(panel(next, name, selected, isExample)));
  fill(ledgerEl, toDom(ledger(next, selected)));
  fill(printEl, toDom(fingerprint(next)));
  if (backButton) backButton.hidden = isExample;
  if (fresh && panelEl) {
    replay(panelEl, "fresh");
    if (ledgerEl) reveals(ledgerEl);
  }
}

/** Shows one step without rebuilding the panel, so the control in use keeps the keyboard. */
function goTo(nextStep: number, finding = -1): void {
  if (!report || report.session.steps === 0) return;
  step = Math.max(1, Math.min(report.session.steps, nextStep));
  selected = finding >= 0 ? finding : report.findings.findIndex((f) => f.step === step);
  for (const el of document.querySelectorAll(".tape-mark, .row")) {
    const on = el.getAttribute("data-i") === String(selected);
    el.classList.toggle("is-on", on);
    if (el.classList.contains("row")) el.setAttribute("aria-pressed", on ? "true" : "false");
  }
  document.querySelector(".tape-cursor")?.setAttribute("transform", cursorAt(step, report.session.steps));
  const old = $("readout");
  if (old) {
    const fresh = toDom(readout(report, selected, step)) as HTMLElement;
    old.replaceWith(fresh);
    if (!reduced()) fresh.classList.add("readout-in");
  }
  const scrub = $<HTMLInputElement>("scrub");
  if (scrub && scrub.value !== String(step)) scrub.value = String(step);
}

const goToFinding = (index: number): void => {
  const f = report?.findings[index];
  if (f) goTo(f.step, index);
};

/** The next finding after the step on show (or the one before it), wherever the slider has been left. */
function stepFinding(direction: number): void {
  if (!report || report.findings.length === 0) return;
  const last = report.findings.length - 1;
  const ahead = report.findings.findIndex((f) => f.step > step);
  const fromHere = direction > 0 ? (ahead === -1 ? last : ahead) : (ahead === -1 ? last + 1 : ahead) - 1;
  goToFinding(Math.max(0, Math.min(last, selected >= 0 ? selected + direction : fromHere)));
}

function fail(message: string): void {
  if (status) status.textContent = "";
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.hidden = false;
  replay(errorEl, "nudge");
}

async function read(text: string, name: string): Promise<void> {
  if (errorEl) errorEl.hidden = true;
  if (status) status.textContent = "Reading the log…";
  // Let the status line paint before a long parse blocks the page.
  await new Promise((done) => setTimeout(done, 20));
  try {
    const next = await analyze(text);
    show(next, quote(name, 48) || "Your log", true);
    const n = next.findings.length;
    const found = n === 0 ? "Nothing found." : n === 1 ? "1 finding." : `${n.toLocaleString("en-GB")} findings.`;
    if (status) status.textContent = `Read ${next.input.lines.toLocaleString("en-GB")} lines. ${found}${cut(next) ? ` ${cut(next)}` : ""}`;
    panelEl?.focus({ preventScroll: true });
    panelEl?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "nearest" });
  } catch (e) {
    fail(e instanceof NotALog ? `${e.message} Nothing was read.` : "This could not be read as a session log. Nothing was read.");
  }
}

async function readFile(file: File | undefined): Promise<void> {
  if (!file) return;
  const megabytes = LIMITS.bytes / 1024 / 1024;
  if (file.size > LIMITS.bytes) return fail(`That file is ${Math.ceil(file.size / 1024 / 1024).toLocaleString("en-GB")} MB. The largest log this page reads is ${megabytes} MB.`);
  if (file.size === 0) return fail("That file is empty.");
  await read(await file.text(), file.name);
}

const stored = $("example-report")?.textContent;
if (stored) {
  try {
    example = JSON.parse(stored) as Report;
    report = example;
    selected = startAt(example);
    step = example.findings[selected]?.step ?? 1;
  } catch {
    example = null;
  }
}

fileInput?.addEventListener("change", () => {
  void readFile(fileInput.files?.[0]);
  fileInput.value = "";
});
$("choose")?.addEventListener("click", () => fileInput?.click());
$("paste-open")?.addEventListener("click", (event) => {
  if (!pasteBox) return;
  pasteBox.hidden = !pasteBox.hidden;
  (event.currentTarget as HTMLElement).setAttribute("aria-expanded", String(!pasteBox.hidden));
  if (!pasteBox.hidden) pasteText?.focus();
});
$("paste-read")?.addEventListener("click", () => {
  const text = pasteText?.value ?? "";
  if (!text.trim()) return fail("Paste the lines of a session log first: one JSON object per line.");
  void read(text, "Pasted text");
});
backButton?.addEventListener("click", () => {
  if (example) show(example, "Example session", true);
  if (status) status.textContent = "";
  if (errorEl) errorEl.hidden = true;
});

document.addEventListener("click", (event) => {
  const from = event.target as Element | null;
  const target = from?.closest("[data-step], [data-i], [data-group]");
  if (target?.hasAttribute("data-step")) return stepFinding(Number(target.getAttribute("data-step")));
  if (target?.hasAttribute("data-i")) return goToFinding(Number(target.getAttribute("data-i")));
  if (target?.hasAttribute("data-group")) {
    const group = target.getAttribute("data-group");
    goToFinding(report?.findings.findIndex((f) => f.group === group) ?? -1);
    return document.getElementById(`group-${group}`)?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
  }
  // Anywhere else on the tape: the step under the pointer.
  const svg = from?.closest("#tape");
  if (svg && report) {
    const box = svg.getBoundingClientRect();
    goTo(stepAt(((event as MouseEvent).clientX - box.left) / box.width, report.session.steps));
  }
});
document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | null;
  if (target?.id === "scrub") goTo(Number(target.value));
});

// A file dropped anywhere on the page is read. Without this the browser would open it, leaving the page.
document.addEventListener("dragover", (event) => {
  event.preventDefault();
  document.body.classList.add("dropping");
});
document.addEventListener("dragleave", () => document.body.classList.remove("dropping"));
document.addEventListener("drop", (event) => {
  event.preventDefault();
  document.body.classList.remove("dropping");
  void readFile(event.dataTransfer?.files?.[0]);
});

$("copy-id")?.addEventListener("click", async (event) => {
  const id = $("report-id")?.textContent ?? "";
  const said = (event.currentTarget as HTMLElement).querySelector(".copy-said");
  try {
    await navigator.clipboard.writeText(id);
    if (said) said.textContent = "Copied";
  } catch {
    if (said) said.textContent = "Select the id and copy it";
  }
});

reveals();
document.documentElement.classList.add("js");
