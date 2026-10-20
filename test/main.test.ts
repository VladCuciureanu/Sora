import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { parseCliArgs as parseOrHelp, UsageError } from "../src/main.ts";

function parseCliArgs(args: string[]) {
  const parsed = parseOrHelp(args);
  assert.ok(parsed, "expected arguments, got a help request");
  return parsed;
}

test("parseCliArgs - parses minimal args", () => {
  const args = parseCliArgs(["input.cbz"]);
  assert.equal(args.input, "input.cbz");
  assert.equal(args.output, "input_upscaled.cbz");
  assert.equal(args.engine, "waifu2x");
  assert.equal(args.scale, 2);
  assert.equal(args.noise, -1);
  assert.equal(args.dryRun, false);
});

test("parseCliArgs - parses all options", () => {
  const args = parseCliArgs([
    join("comics", "vol1.cbz"),
    "-o", join("out", "vol1_4x.cbz"),
    "-e", "waifu2x",
    "-s", "4",
    "-n", "2",
    "--config", join("tmp", "config.json"),
    "--dry-run",
  ]);
  assert.equal(args.input, join("comics", "vol1.cbz"));
  assert.equal(args.output, join("out", "vol1_4x.cbz"));
  assert.equal(args.engine, "waifu2x");
  assert.equal(args.scale, 4);
  assert.equal(args.noise, 2);
  assert.equal(args.configPath, join("tmp", "config.json"));
  assert.equal(args.dryRun, true);
});

test("parseCliArgs - uses long option names", () => {
  const args = parseCliArgs([
    "test.cbz",
    "--output", "result.cbz",
    "--engine", "waifu2x",
  ]);
  assert.equal(args.output, "result.cbz");
  assert.equal(args.engine, "waifu2x");
});

test("parseCliArgs - default output includes directory", () => {
  const args = parseCliArgs([join("path", "to", "comic.cbz")]);
  assert.equal(args.output, join("path", "to", "comic_upscaled.cbz"));
});

test("parseCliArgs - returns null when help is requested", () => {
  assert.equal(parseOrHelp(["--help"]), null);
  assert.equal(parseOrHelp(["input.cbz", "-h"]), null);
});

test("parseCliArgs - throws a UsageError with help when input is missing", () => {
  assert.throws(
    () => parseOrHelp([]),
    (err: unknown) => {
      assert.ok(err instanceof UsageError);
      assert.match(err.message, /input CBZ file is required/);
      assert.equal(err.showHelp, true);
      return true;
    },
  );
});

for (const [flag, value, message] of [
  ["--scale", "3", /--scale must be 2 or 4/],
  ["--noise", "4", /--noise must be -1, 0, 1, 2, or 3/],
  ["--concurrency", "0", /--concurrency must be a positive integer/],
  ["--concurrency", "1.5", /--concurrency must be a positive integer/],
] as const) {
  test(`parseCliArgs - throws a UsageError for ${flag} ${value}`, () => {
    assert.throws(
      () => parseOrHelp(["input.cbz", flag, value]),
      (err: unknown) => {
        assert.ok(err instanceof UsageError);
        assert.match(err.message, message);
        assert.equal(err.showHelp, false);
        return true;
      },
    );
  });
}
