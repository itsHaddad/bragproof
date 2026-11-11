import { expect, test } from "bun:test";
import { Glob } from "bun";
import { canonical, hashOf } from "../src/receipt/canonical.ts";
import { specProblems } from "../src/receipt/types.ts";
import { meets } from "../src/check/run.ts";
import { spec } from "./helpers.ts";

test("no source file grows past 250 lines: one module per area", async () => {
  for await (const file of new Glob("src/**/*.ts").scan(".")) {
    const lines = (await Bun.file(file).text()).split("\n").length;
    expect(`${file}: ${lines <= 250 ? "ok" : lines + " lines"}`).toBe(`${file}: ok`);
  }
});

test("canonical form does not depend on key order", () => {
  expect(canonical({ b: 1, a: [true, null, "x"], c: undefined })).toBe('{"a":[true,null,"x"],"b":1}');
  expect(hashOf({ x: 1, y: { b: 2, a: 1 } })).toBe(hashOf({ y: { a: 1, b: 2 }, x: 1 }));
  expect(() => canonical({ n: Number.NaN })).toThrow();
});

test("a spec must pin an exact version and one expectation per step", () => {
  expect(specProblems(spec())).toEqual([]);
  const loose = spec();
  loose.subject.version = "^1.0.0";
  expect(specProblems(loose).join()).toMatch(/exact version/);
  const two = spec();
  two.steps[0]!.expect = { contains: "a", equals: "b" };
  expect(specProblems(two).join()).toMatch(/exactly one/);
  const shell = spec();
  shell.subject.package = "echo; rm -rf /";
  expect(specProblems(shell).join()).toMatch(/npm package name/);
});

test("expectations", () => {
  expect(meets({ equals: "a" }, "a")).toBe(true);
  expect(meets({ equals: "a" }, "ab")).toBe(false);
  expect(meets({ contains: "b" }, "abc")).toBe(true);
  expect(meets({ matches: "^\\d+$" }, "123")).toBe(true);
  expect(meets({}, "anything")).toBe(false);
});
