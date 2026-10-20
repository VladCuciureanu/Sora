import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { type Runner, run } from "../src/exec.ts";
import { type CliArgs, upscaleCbz } from "../src/main.ts";
import { METADATA_FILENAME } from "../src/metadata.ts";
import { skipWithoutZip } from "./support/tools.ts";

const makeTempDir = () => mkdtemp(join(tmpdir(), "sora-test-"));
const engine = { binaryPath: "waifu2x" };

/**
 * Fake for `run`. Unless `realZip` is set, unzip and zip copy directories, so a
 * "CBZ" is a plain directory and no zip/unzip is needed. waifu2x writes
 * `upscaled:<scale>:<original>`, or fails with `waifu2xError` when given.
 */
function fakeRun(options: { realZip?: boolean; waifu2xError?: string } = {}) {
  const commands: string[] = [];
  /** Images passed to waifu2x, relative to the extraction directory, and the rest of its args. */
  const waifu2xCalls: { file: string; args: string[] }[] = [];
  let extractDir = "";

  const fake: Runner = async (command, args, runOptions = {}) => {
    commands.push(command);
    if (command === "unzip") {
      extractDir = args[args.indexOf("-d") + 1];
      if (options.realZip) return run(command, args, runOptions);
      await cp(args[1], extractDir, { recursive: true });
    } else if (command === "zip") {
      if (options.realZip) return run(command, args, runOptions);
      await cp(runOptions.cwd ?? ".", args[1], { recursive: true });
    } else {
      const input = args[args.indexOf("-i") + 1];
      const output = args[args.indexOf("-o") + 1];
      waifu2xCalls.push({ file: relative(extractDir, input), args: args.slice(4) });
      if (options.waifu2xError) return { success: false, stderr: options.waifu2xError };
      const scale = args[args.indexOf("-s") + 1];
      await writeFile(output, `upscaled:${scale}:${await readFile(input, "utf8")}`);
    }
    return { success: true, stderr: "" };
  };
  return { run: fake, commands, waifu2xCalls };
}

function makeArgs(input: string, output: string): CliArgs {
  return { input, output, engine: "waifu2x", scale: 4, noise: 1, dryRun: false };
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
    const fake = fakeRun();

    await upscaleCbz(makeArgs(input, output), engine, { run: fake.run });

    assert.deepEqual(
      fake.waifu2xCalls.map((c) => c.file),
      [join("chapter1", "page01.png"), "cover.jpg"],
    );
    for (const call of fake.waifu2xCalls) {
      assert.deepEqual(call.args, ["-s", "4", "-n", "1"]);
    }
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

    await upscaleCbz(makeArgs(input, output), engine, { run: fakeRun().run });

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
    assert.equal(meta.engine, "waifu2x");
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
    const fake = fakeRun();

    await upscaleCbz(makeArgs(input, output), engine, { run: fake.run });

    assert.deepEqual(
      fake.waifu2xCalls.map((c) => c.file),
      [join("chapter1", "page01.png"), "cover.jpg"],
    );
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
    const fake = fakeRun({ waifu2xError: "engine exploded" });

    await assert.rejects(
      () => upscaleCbz(makeArgs(input, output), engine, { run: fake.run }),
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
    const fake = fakeRun();

    await assert.rejects(
      () => upscaleCbz(makeArgs(input, output), engine, { run: fake.run }),
      /Output file already exists/,
    );
    assert.deepEqual(fake.commands, []);
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

    await upscaleCbz(makeArgs(input, output), engine, { run: fakeRun({ realZip: true }).run });

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
    assert.equal(
      JSON.parse(await readFile(join(check, METADATA_FILENAME), "utf8")).engine,
      "waifu2x",
    );
  } finally {
    await rm(workDir, { recursive: true });
  }
});
