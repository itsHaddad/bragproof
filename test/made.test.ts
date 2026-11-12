import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { line, page } from "../src/cli/made.ts";
import { find, load, problems, put, remove } from "../src/made/store.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "made-")), "made.jsonl");
const captions = { name: "Captions", what: "Adds burned-in subtitles to a short video, in the browser.", kind: "site" as const, url: "https://example.com/captions", project: "studio", tags: ["video", "subtitles"], state: "live" as const };

test("an entry must say what it is and where it is", () => {
  expect(problems(captions)).toEqual([]);
  expect(problems({ ...captions, what: "tool" }).join()).toMatch(/sentence/);
  expect(problems({ ...captions, url: undefined }).join()).toMatch(/where/);
  expect(problems({ ...captions, url: "javascript:alert(1)" }).join()).toMatch(/http/);
  expect(problems({ ...captions, kind: "thing" as never }).join()).toMatch(/kind/);
});

test("adding the same thing again updates it rather than listing it twice", () => {
  const f = file();
  const first = put(captions, f, new Date("2026-01-01"));
  const again = put({ ...captions, use: "open the page and drop a video on it" }, f, new Date("2026-02-01"));
  expect(again.id).toBe(first.id);
  expect(load(f).length).toBe(1);
  expect(load(f)[0]!.made).toBe("2026-01-01");
  expect(load(f)[0]!.updated).toBe("2026-02-01");
  expect(put({ ...captions, project: "other" }, f).id).not.toBe(first.id);
  expect(remove(first.id, f)).toBe(true);
  expect(load(f).length).toBe(1);
});

test("search wants every word, ranks a name match first and sinks what was abandoned", () => {
  const f = file();
  put(captions, f);
  put({ name: "Clip notes", what: "Keeps notes about each video with subtitles timing.", kind: "script", path: "/tmp/x", project: "studio" }, f);
  put({ name: "Old captions", what: "First try at subtitles for video.", kind: "script", path: "/tmp/y", state: "abandoned" }, f);
  const all = load(f);
  expect(find(all, "captions").map((e) => e.name)).toEqual(["Captions", "Old captions"]);
  expect(find(all, "video subtitles").map((e) => e.name)[0]).toBe("Captions");
  expect(find(all, "subtitles nothing-has-this")).toEqual([]);
  expect(find(all, "video", { kind: "script" }).length).toBe(2);
});

test("a broken line in the file does not lose the rest", async () => {
  const f = file();
  put(captions, f);
  await Bun.write(f, (await Bun.file(f).text()) + "{not json\n");
  expect(load(f).length).toBe(1);
});

test("what agents wrote cannot become markup on the page, and a line shows where and how", () => {
  const e = put({ ...captions, name: "<script>alert(1)</script>", use: "</pre><img src=x>" }, file());
  const html = page([e]);
  expect(html).not.toContain("<script>alert");
  expect(html).not.toContain("<img");
  expect(line(e)).toContain("where: https://example.com/captions");
});
