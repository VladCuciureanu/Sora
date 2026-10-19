import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  splitIntoBatches,
  buildWaifu2xArgs,
  collectImageFiles,
  createWaifu2xEngine,
} from "../../src/engines/waifu2x.ts";
import type { RunResult } from "../../src/exec.ts";

const makeTempDir = () => mkdtemp(join(tmpdir(), "sora-test-"));

/** Fake waifu2x runner: copies the `-i` file to the `-o` path. */
async function copyRunner(_command: string, args: string[]): Promise<RunResult> {
  const input = args[args.indexOf("-i") + 1];
  const output = args[args.indexOf("-o") + 1];
  await copyFile(input, output);
  return { success: true, stderr: "" };
}

test("splitIntoBatches - splits evenly", () => {
  const items = [1, 2, 3, 4, 5, 6];
  const batches = splitIntoBatches(items, 2);
  assert.deepEqual(batches, [[1, 2], [3, 4], [5, 6]]);
});

test("splitIntoBatches - handles remainder", () => {
  const items = [1, 2, 3, 4, 5];
  const batches = splitIntoBatches(items, 2);
  assert.deepEqual(batches, [[1, 2], [3, 4], [5]]);
});

test("splitIntoBatches - single batch when under size", () => {
  const items = [1, 2, 3];
  const batches = splitIntoBatches(items, 10);
  assert.deepEqual(batches, [[1, 2, 3]]);
});

test("splitIntoBatches - empty input", () => {
  const batches = splitIntoBatches([], 5);
  assert.deepEqual(batches, []);
});

test("buildWaifu2xArgs - basic scale only", () => {
  const args = buildWaifu2xArgs("/in/img.jpg", "/out/img.jpg", { scale: 2, noise: -1 });
  assert.deepEqual(args, ["-i", "/in/img.jpg", "-o", "/out/img.jpg", "-s", "2"]);
});

test("buildWaifu2xArgs - with noise reduction", () => {
  const args = buildWaifu2xArgs("/in/img.jpg", "/out/img.jpg", { scale: 4, noise: 2 });
  assert.deepEqual(args, ["-i", "/in/img.jpg", "-o", "/out/img.jpg", "-s", "4", "-n", "2"]);
});

test("buildWaifu2xArgs - noise level 0 is included", () => {
  const args = buildWaifu2xArgs("/in/img.jpg", "/out/img.jpg", { scale: 2, noise: 0 });
  assert.deepEqual(args, ["-i", "/in/img.jpg", "-o", "/out/img.jpg", "-s", "2", "-n", "0"]);
});

test("collectImageFiles - includes images in subfolders as relative paths", async () => {
  const dir = await makeTempDir();
  await mkdir(join(dir, "chapter1", "extras"), { recursive: true });
  await writeFile(join(dir, "cover.jpg"), "cover");
  await writeFile(join(dir, "chapter1", "page01.png"), "p1");
  await writeFile(join(dir, "chapter1", "extras", "bonus.webp"), "bonus");
  await writeFile(join(dir, "chapter1", "ComicInfo.xml"), "<xml/>");

  const files = await collectImageFiles(dir);
  assert.deepEqual(files, [
    join("chapter1", "extras", "bonus.webp"),
    join("chapter1", "page01.png"),
    "cover.jpg",
  ]);

  await rm(dir, { recursive: true });
});

test("waifu2x upscale - processes nested images and preserves relative paths", async () => {
  const workDir = await makeTempDir();
  const inputDir = join(workDir, "in");
  const outputDir = join(workDir, "out");
  await mkdir(join(inputDir, "chapter1"), { recursive: true });
  await mkdir(outputDir);
  await writeFile(join(inputDir, "cover.jpg"), "cover");
  await writeFile(join(inputDir, "chapter1", "page01.png"), "nested");

  const engine = createWaifu2xEngine({ binaryPath: "waifu2x", runner: copyRunner });
  await engine.upscale(inputDir, outputDir, { scale: 2, noise: -1 });

  assert.equal(await readFile(join(outputDir, "cover.jpg"), "utf8"), "cover");
  assert.equal(await readFile(join(outputDir, "chapter1", "page01.png"), "utf8"), "nested");

  await rm(workDir, { recursive: true });
});
