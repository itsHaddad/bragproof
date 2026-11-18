// The page's script. It reads a log the person chooses, on their device, and shows the report.
// It makes no network request: the page's content policy forbids it, and there is nothing to send to.

import { analyze } from "../core/analyze.ts";
import { LIMITS } from "../core/parse.ts";
import { quote } from "../core/text.ts";
import { NotALog, type Report } from "../core/types.ts";
import { toDom } from "./h.ts";
import { reduced, replay, reveals } from "./motion.ts";
import { cursorAt } from "./tape.ts";
import { fingerprint, ledger, panel, readout } from "./view.ts";

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
let selected = 0;

function fill(el: HTMLElement | null, node: Node): void {
  if (el) el.replaceChildren(node);
}

function show(next: Report, name: string, fresh: boolean): void {
  report = next;
  selected = 0;
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

/** Moves to another finding without rebuilding the panel, so the control in use keeps the keyboard. */
function select(index: number): void {
  if (!report || report.findings.length === 0) return;
  selected = Math.max(0, Math.min(report.findings.length - 1, index));
  const finding = report.findings[selected];
  for (const el of document.querySelectorAll(".tape-mark, .row")) {
    const on = el.getAttribute("data-i") === String(selected);
    el.classList.toggle("is-on", on);
    if (el.classList.contains("row")) el.setAttribute("aria-pressed", on ? "true" : "false");
  }
  if (finding) document.querySelector(".tape-cursor")?.setAttribute("transform", cursorAt(finding.step, report.session.steps));
  const old = $("readout");
  if (old) {
    const fresh = toDom(readout(report, selected)) as HTMLElement;
    old.replaceWith(fresh);
    if (!reduced()) fresh.classList.add("readout-in");
  }
  const scrub = $<HTMLInputElement>("scrub");
  if (scrub && scrub.value !== String(selected + 1)) scrub.value = String(selected + 1);
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
    if (status) status.textContent = `Read ${next.input.lines.toLocaleString("en-GB")} lines. ${n === 0 ? "Nothing found." : n === 1 ? "1 finding." : `${n.toLocaleString("en-GB")} findings.`}`;
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
  const target = (event.target as Element | null)?.closest("[data-step], [data-i]");
  if (!target) return;
  if (target.hasAttribute("data-step")) select(selected + Number(target.getAttribute("data-step")));
  else if (target.classList.contains("row")) select(Number(target.getAttribute("data-i")));
});
document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | null;
  if (target?.id === "scrub") select(Number(target.value) - 1);
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
  const button = event.currentTarget as HTMLElement;
  const said = button.querySelector(".copy-said");
  try {
    await navigator.clipboard.writeText(id);
    if (said) said.textContent = "Copied";
  } catch {
    if (said) said.textContent = "Select the id and copy it";
  }
});

reveals();
document.documentElement.classList.add("js");
