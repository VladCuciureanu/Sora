import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isImageFile, categorizeFiles, extractCbz, repackCbz } from "../src/cbz.ts";
import { run } from "../src/exec.ts";
import { skipWithoutZip } from "./support/tools.ts";

const makeTempDir = () => mkdtemp(join(tmpdir(), "sora-test-"));

test("isImageFile - recognizes image extensions", () => {
  assert.equal(isImageFile("page01.jpg"), true);
  assert.equal(isImageFile("page02.PNG"), true);
  assert.equal(isImageFile("photo.webp"), true);
  assert.equal(isImageFile("art.bmp"), true);
  assert.equal(isImageFile("ComicInfo.xml"), false);
  assert.equal(isImageFile("readme.txt"), false);
  assert.equal(isImageFile("data.json"), false);
});

test("categorizeFiles - separates images from other files", async () => {
  const dir = await makeTempDir();
  await writeFile(join(dir, "page01.jpg"), "img1");
  await writeFile(join(dir, "page02.png"), "img2");
  await writeFile(join(dir, "ComicInfo.xml"), "<xml/>");
  await writeFile(join(dir, "readme.txt"), "hello");

  const result = await categorizeFiles(dir);
  assert.deepEqual(result.imageFiles, ["page01.jpg", "page02.png"]);
  assert.deepEqual(result.otherFiles, ["ComicInfo.xml", "readme.txt"]);

  await rm(dir, { recursive: true });
});

test("categorizeFiles - handles nested directories", async () => {
  const dir = await makeTempDir();
  await mkdir(join(dir, "sub"));
  await writeFile(join(dir, "sub", "page01.jpg"), "img");
  await writeFile(join(dir, "meta.xml"), "<xml/>");

  const result = await categorizeFiles(dir);
  assert.deepEqual(result.imageFiles, [join("sub", "page01.jpg")]);
  assert.deepEqual(result.otherFiles, ["meta.xml"]);

  await rm(dir, { recursive: true });
});

test("extractCbz and repackCbz - round trip", { skip: skipWithoutZip }, async () => {
  const workDir = await makeTempDir();
  const sourceDir = join(workDir, "source");
  const extractDir = join(workDir, "extracted");
  const reExtractDir = join(workDir, "re-extracted");
  const cbzPath = join(workDir, "test.cbz");
  const outputPath = join(workDir, "output.cbz");

  // Create source files
  await mkdir(sourceDir);
  await mkdir(extractDir);
  await mkdir(reExtractDir);
  await writeFile(join(sourceDir, "page01.jpg"), "image-data-1");
  await writeFile(join(sourceDir, "page02.png"), "image-data-2");
  await writeFile(join(sourceDir, "ComicInfo.xml"), "<ComicInfo/>");

  // Create a CBZ (zip) from source
  const zipped = await run("zip", ["-r", cbzPath, "."], { cwd: sourceDir });
  assert.ok(zipped.success, zipped.stderr);

  // Extract
  const contents = await extractCbz(cbzPath, extractDir);
  assert.deepEqual(contents.imageFiles, ["page01.jpg", "page02.png"]);
  assert.deepEqual(contents.otherFiles, ["ComicInfo.xml"]);

  // Verify file content
  const img1 = await readFile(join(extractDir, "page01.jpg"), "utf8");
  assert.equal(img1, "image-data-1");

  // Repack
  await repackCbz(extractDir, outputPath);
  const info = await stat(outputPath);
  assert.ok(info.isFile());
  assert.ok(info.size > 0);

  // Re-extract and verify
  await extractCbz(outputPath, reExtractDir);
  const reImg1 = await readFile(join(reExtractDir, "page01.jpg"), "utf8");
  assert.equal(reImg1, "image-data-1");

  await rm(workDir, { recursive: true });
});

