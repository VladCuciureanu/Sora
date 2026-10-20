import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { categorizeFiles } from "../src/cbz.ts";
import type { UpscaleEngine, UpscaleOpts } from "../src/engines/engine.ts";
import { run } from "../src/exec.ts";
import { upscaleCbz, type ArchiveIO, type CliArgs } from "../src/main.ts";
import { skipWithoutZip } from "./support/tools.ts";

const makeTempDir = () => mkdtemp(join(tmpdir(), "sora-test-"));

/** Archive stand-in that treats a "CBZ" as a plain directory, so no zip/unzip is needed. */
const dirArchive: ArchiveIO = {
  async extract(cbzPath, outputDir) {
    await cp(cbzPath, outputDir, { recursive: true });
    return categorizeFiles(outputDir);
  },
  async repack(sourceDir, outputPath) {
    await cp(sourceDir, outputPath, { recursive: true });
  },
};

/** Fake engine: writes `upscaled:<scale>:<original>` for every image it is given. */
function fakeEngine(): UpscaleEngine & { calls: { files: string[]; opts: UpscaleOpts }[] } {
  const calls: { files: string[]; opts: UpscaleOpts }[] = [];
  return {
    name: "fake",
    calls,
    async checkAvailable() {
      return true;
    },
    async upscale(inputDir, outputDir, opts) {
      const { imageFiles } = await categorizeFiles(inputDir);
      calls.push({ files: imageFiles, opts });
      for (const file of imageFiles) {
        const out = join(outputDir, file);
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, `upscaled:${opts.scale}:${await readFile(join(inputDir, file), "utf8")}`);
      }
    },
  };
}

function makeArgs(input: string, output: string): CliArgs {
  return { input, output, engine: "fake", scale: 4, noise: 1, dryRun: false };
}

async function writeSampleComic(dir: string): Promise<void> {
  await mkdir(join(dir, "chapter1"), { recursive: true });
  await writeFile(join(dir, "cover.jpg"), "cover");
  await writeFile(join(dir, "chapter1", "page01.png"), "page01");
  await writeFile(join(dir, "readme.txt"), "hello");
}

test("upscaleCbz - upscales images, copies other files, and repacks", async () => {
  const workDir = await makeTempDir();
  try {
    const input = join(workDir, "comic");
    const output = join(workDir, "comic_upscaled");
    await writeSampleComic(input);
    const engine = fakeEngine();

    await upscaleCbz(makeArgs(input, output), engine, dirArchive);

    assert.equal(engine.calls.length, 1);
    assert.deepEqual(engine.calls[0].opts, { scale: 4, noise: 1 });
    assert.deepEqual(engine.calls[0].files, [join("chapter1", "page01.png"), "cover.jpg"]);
    assert.equal(await readFile(join(output, "cover.jpg"), "utf8"), "upscaled:4:cover");
    assert.equal(await readFile(join(output, "chapter1", "page01.png"), "utf8"), "upscaled:4:page01");
    assert.equal(await readFile(join(output, "readme.txt"), "utf8"), "hello");
  } finally {
    await rm(workDir, { recursive: true });
  }
});

test("upscaleCbz - propagates engine failures", async () => {
  const workDir = await makeTempDir();
  try {
    const input = join(workDir, "comic");
    const output = join(workDir, "comic_upscaled");
    await writeSampleComic(input);
    const engine: UpscaleEngine = {
      name: "broken",
      async checkAvailable() {
        return true;
      },
      async upscale() {
        throw new Error("engine exploded");
      },
    };

    await assert.rejects(() => upscaleCbz(makeArgs(input, output), engine, dirArchive), /engine exploded/);
    await assert.rejects(() => readdir(output), { code: "ENOENT" });
  } finally {
    await rm(workDir, { recursive: true });
  }
});

test("upscaleCbz - real CBZ round trip through zip/unzip", { skip: skipWithoutZip }, async () => {
  const workDir = await makeTempDir();
  try {
    const source = join(workDir, "source");
    const input = join(workDir, "comic.cbz");
    const output = join(workDir, "comic_upscaled.cbz");
    const check = join(workDir, "check");
    await writeSampleComic(source);
    const zipped = await run("zip", ["-r", input, "."], { cwd: source });
    assert.ok(zipped.success, zipped.stderr);

    await upscaleCbz(makeArgs(input, output), fakeEngine());

    await mkdir(check);
    const unzipped = await run("unzip", [output, "-d", check]);
    assert.ok(unzipped.success, unzipped.stderr);
    assert.equal(await readFile(join(check, "cover.jpg"), "utf8"), "upscaled:4:cover");
    assert.equal(await readFile(join(check, "chapter1", "page01.png"), "utf8"), "upscaled:4:page01");
    assert.equal(await readFile(join(check, "readme.txt"), "utf8"), "hello");
  } finally {
    await rm(workDir, { recursive: true });
  }
});
