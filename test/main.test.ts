import { assertEquals } from "@std/assert";
import { parseCliArgs } from "../src/main.ts";

Deno.test("parseCliArgs - parses minimal args", () => {
  const args = parseCliArgs(["input.cbz"]);
  assertEquals(args.input, "input.cbz");
  assertEquals(args.output, "input_upscaled.cbz");
  assertEquals(args.engine, "waifu2x");
  assertEquals(args.scale, 2);
  assertEquals(args.noise, -1);
  assertEquals(args.dryRun, false);
});

Deno.test("parseCliArgs - parses all options", () => {
  const args = parseCliArgs([
    "comics/vol1.cbz",
    "-o", "out/vol1_4x.cbz",
    "-e", "waifu2x",
    "-s", "4",
    "-n", "2",
    "--config", "/tmp/config.json",
    "--dry-run",
  ]);
  assertEquals(args.input, "comics/vol1.cbz");
  assertEquals(args.output, "out/vol1_4x.cbz");
  assertEquals(args.engine, "waifu2x");
  assertEquals(args.scale, 4);
  assertEquals(args.noise, 2);
  assertEquals(args.configPath, "/tmp/config.json");
  assertEquals(args.dryRun, true);
});

Deno.test("parseCliArgs - uses long option names", () => {
  const args = parseCliArgs([
    "test.cbz",
    "--output", "result.cbz",
    "--engine", "waifu2x",
  ]);
  assertEquals(args.output, "result.cbz");
  assertEquals(args.engine, "waifu2x");
});

Deno.test("parseCliArgs - default output includes directory", () => {
  const args = parseCliArgs(["/path/to/comic.cbz"]);
  assertEquals(args.output, "/path/to/comic_upscaled.cbz");
});
