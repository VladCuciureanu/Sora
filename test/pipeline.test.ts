import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { categorizeFiles } from "../src/cbz.ts";
import type { UpscaleEngine, UpscaleOpts } from "../src/engines/engine.ts";
import { run } from "../src/exec.ts";
import { type ArchiveIO, type CliArgs, upscaleCbz } from "../src/main.ts";
import { METADATA_FILENAME } from "../src/metadata.ts";
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
        await writeFile(
          out,
          `upscaled:${opts.scale}:${await readFile(join(inputDir, file), "utf8")}`,
        );
      }
    },
  };
}

function makeArgs(input: string, output: string): CliArgs {
  return { input, output, engine: "fake", scale: 4, noise: 1, dryRun: false };
}

const COMIC_INFO = `<?xml version="1.0"?>
<ComicInfo>
  <Title>Test</Title>
</ComicInfo>
`;

async function writeSampleComic(dir: string): Promise<void> {
  await mkdir(join(dir, "chapter1"), { recursive: true });
  await writeFile(join(dir, "cover.jpg"), "cover");
  await writeFile(join(dir, "chapter1", "page01.png"), "page01");
  await writeFile(join(dir, "readme.txt"), "hello");
  await writeFile(join(dir, "ComicInfo.xml"), COMIC_INFO);
}

/** Recursively list files under `dir` as sorted relative paths. */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort();
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
    assert.equal(
      await readFile(join(output, "chapter1", "page01.png"), "utf8"),
      "upscaled:4:page01",
    );
    assert.equal(await readFile(join(output, "readme.txt"), "utf8"), "hello");
  } finally {
    await rm(workDir, { recursive: true });
  }
});

test("upscaleCbz - writes one sora.upscale.json at the root and leaves ComicInfo.xml untouched", async () => {
  const workDir = await makeTempDir();
  try {
    const input = join(workDir, "comic");
    const output = join(workDir, "comic_upscaled");
    await writeSampleComic(input);
    await writeFile(join(input, "chapter1", "notes.txt"), "nested");

    await upscaleCbz(makeArgs(input, output), fakeEngine(), dirArchive);

    assert.deepEqual(await listFiles(output), [
      "ComicInfo.xml",
      join("chapter1", "notes.txt"),
      join("chapter1", "page01.png"),
      "cover.jpg",
      "readme.txt",
      METADATA_FILENAME,
    ]);
    assert.equal(await readFile(join(output, "ComicInfo.xml"), "utf8"), COMIC_INFO);
    assert.equal(await readFile(join(output, "chapter1", "notes.txt"), "utf8"), "nested");
    const meta = JSON.parse(await readFile(join(output, METADATA_FILENAME), "utf8"));
    assert.equal(meta.engine, "fake");
    assert.equal(meta.scale, 4);
    assert.equal(meta.noise, 1);
    assert.ok(!Number.isNaN(Date.parse(meta.timestamp)));
  } finally {
    await rm(workDir, { recursive: true });
  }
});

test("upscaleCbz - copies images the engine cannot read through unchanged", async () => {
  const workDir = await makeTempDir();
  try {
    const input = join(workDir, "comic");
    const output = join(workDir, "comic_upscaled");
    await writeSampleComic(input);
    await writeFile(join(input, "chapter1", "page02.gif"), "gif-page");
    await writeFile(join(input, "back.bmp"), "bmp-page");
    const engine = fakeEngine();

    await upscaleCbz(makeArgs(input, output), engine, dirArchive);

    assert.deepEqual(engine.calls[0].files, [join("chapter1", "page01.png"), "cover.jpg"]);
    assert.equal(await readFile(join(output, "chapter1", "page02.gif"), "utf8"), "gif-page");
    assert.equal(await readFile(join(output, "back.bmp"), "utf8"), "bmp-page");
    assert.equal(await readFile(join(output, "cover.jpg"), "utf8"), "upscaled:4:cover");
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

    await assert.rejects(
      () => upscaleCbz(makeArgs(input, output), engine, dirArchive),
      /engine exploded/,
    );
    await assert.rejects(() => readdir(output), { code: "ENOENT" });
  } finally {
    await rm(workDir, { recursive: true });
  }
});

test("upscaleCbz - refuses an existing output before extracting or upscaling", async () => {
  const workDir = await makeTempDir();
  try {
    const input = join(workDir, "comic");
    const output = join(workDir, "comic_upscaled.cbz");
    await writeSampleComic(input);
    await writeFile(output, "already here");
    const engine = fakeEngine();
    let extracted = false;
    const archive: ArchiveIO = {
      ...dirArchive,
      async extract(cbzPath, outputDir) {
        extracted = true;
        return dirArchive.extract(cbzPath, outputDir);
      },
    };

    await assert.rejects(
      () => upscaleCbz(makeArgs(input, output), engine, archive),
      /Output file already exists/,
    );
    assert.equal(extracted, false);
    assert.equal(engine.calls.length, 0);
    assert.equal(await readFile(output, "utf8"), "already here");
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
    assert.equal(
      await readFile(join(check, "chapter1", "page01.png"), "utf8"),
      "upscaled:4:page01",
    );
    assert.equal(await readFile(join(check, "readme.txt"), "utf8"), "hello");
    assert.equal(await readFile(join(check, "ComicInfo.xml"), "utf8"), COMIC_INFO);
    assert.equal(JSON.parse(await readFile(join(check, METADATA_FILENAME), "utf8")).engine, "fake");
  } finally {
    await rm(workDir, { recursive: true });
  }
});
