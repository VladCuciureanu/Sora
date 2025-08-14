import { assertEquals, assertRejects, assert } from "@std/assert";
import { join } from "@std/path";
import { isImageFile, categorizeFiles, extractCbz, repackCbz } from "../src/cbz.ts";

Deno.test("isImageFile - recognizes image extensions", () => {
  assertEquals(isImageFile("page01.jpg"), true);
  assertEquals(isImageFile("page02.PNG"), true);
  assertEquals(isImageFile("photo.webp"), true);
  assertEquals(isImageFile("art.bmp"), true);
  assertEquals(isImageFile("ComicInfo.xml"), false);
  assertEquals(isImageFile("readme.txt"), false);
  assertEquals(isImageFile("data.json"), false);
});

Deno.test("categorizeFiles - separates images from other files", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "page01.jpg"), "img1");
  await Deno.writeTextFile(join(dir, "page02.png"), "img2");
  await Deno.writeTextFile(join(dir, "ComicInfo.xml"), "<xml/>");
  await Deno.writeTextFile(join(dir, "readme.txt"), "hello");

  const result = await categorizeFiles(dir);
  assertEquals(result.imageFiles, ["page01.jpg", "page02.png"]);
  assertEquals(result.otherFiles, ["ComicInfo.xml", "readme.txt"]);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("categorizeFiles - handles nested directories", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(join(dir, "sub"));
  await Deno.writeTextFile(join(dir, "sub", "page01.jpg"), "img");
  await Deno.writeTextFile(join(dir, "meta.xml"), "<xml/>");

  const result = await categorizeFiles(dir);
  assertEquals(result.imageFiles, ["sub/page01.jpg"]);
  assertEquals(result.otherFiles, ["meta.xml"]);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("extractCbz and repackCbz - round trip", async () => {
  const workDir = await Deno.makeTempDir();
  const sourceDir = join(workDir, "source");
  const extractDir = join(workDir, "extracted");
  const reExtractDir = join(workDir, "re-extracted");
  const cbzPath = join(workDir, "test.cbz");
  const outputPath = join(workDir, "output.cbz");

  // Create source files
  await Deno.mkdir(sourceDir);
  await Deno.mkdir(extractDir);
  await Deno.mkdir(reExtractDir);
  await Deno.writeTextFile(join(sourceDir, "page01.jpg"), "image-data-1");
  await Deno.writeTextFile(join(sourceDir, "page02.png"), "image-data-2");
  await Deno.writeTextFile(join(sourceDir, "ComicInfo.xml"), "<ComicInfo/>");

  // Create a CBZ (zip) from source
  const zipCmd = new Deno.Command("zip", {
    args: ["-r", cbzPath, "."],
    cwd: sourceDir,
    stdout: "null",
    stderr: "null",
  });
  await zipCmd.output();

  // Extract
  const contents = await extractCbz(cbzPath, extractDir);
  assertEquals(contents.imageFiles, ["page01.jpg", "page02.png"]);
  assertEquals(contents.otherFiles, ["ComicInfo.xml"]);

  // Verify file content
  const img1 = await Deno.readTextFile(join(extractDir, "page01.jpg"));
  assertEquals(img1, "image-data-1");

  // Repack
  await repackCbz(extractDir, outputPath);
  const stat = await Deno.stat(outputPath);
  assert(stat.isFile);
  assert(stat.size > 0);

  // Re-extract and verify
  await extractCbz(outputPath, reExtractDir);
  const reImg1 = await Deno.readTextFile(join(reExtractDir, "page01.jpg"));
  assertEquals(reImg1, "image-data-1");

  await Deno.remove(workDir, { recursive: true });
});

Deno.test("repackCbz - errors if output file exists", async () => {
  const dir = await Deno.makeTempDir();
  const sourceDir = join(dir, "source");
  await Deno.mkdir(sourceDir);
  await Deno.writeTextFile(join(sourceDir, "page.jpg"), "data");

  const outputPath = join(dir, "existing.cbz");
  await Deno.writeTextFile(outputPath, "already here");

  await assertRejects(
    () => repackCbz(sourceDir, outputPath),
    Error,
    "already exists",
  );

  await Deno.remove(dir, { recursive: true });
});
