import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUpscaleMetadata, tagFile } from "../src/metadata.ts";
import type { UpscaleMetadata } from "../src/metadata.ts";

const makeTempDir = () => mkdtemp(join(tmpdir(), "sora-test-"));

function makeMeta(): UpscaleMetadata {
  return {
    engine: "waifu2x",
    scale: 2,
    noise: 1,
    timestamp: "2025-01-01T00:00:00.000Z",
  };
}

test("createUpscaleMetadata - creates metadata with timestamp", () => {
  const meta = createUpscaleMetadata("waifu2x", 2, -1);
  assert.equal(meta.engine, "waifu2x");
  assert.equal(meta.scale, 2);
  assert.equal(meta.noise, -1);
  assert.ok(meta.timestamp.length > 0);
});

test("tagFile - injects metadata into XML file", async () => {
  const dir = await makeTempDir();
  const xmlPath = join(dir, "ComicInfo.xml");
  await writeFile(xmlPath, `<?xml version="1.0"?>\n<ComicInfo>\n  <Title>Test</Title>\n</ComicInfo>`);

  await tagFile(xmlPath, makeMeta());

  const content = await readFile(xmlPath, "utf8");
  assert.ok(content.includes("<UpscaleInfo>"));
  assert.ok(content.includes("<Engine>waifu2x</Engine>"));
  assert.ok(content.includes("<Scale>2</Scale>"));
  assert.ok(content.includes("<Noise>1</Noise>"));
  // Ensure it's before the closing tag
  const upscaleIdx = content.indexOf("<UpscaleInfo>");
  const closingIdx = content.indexOf("</ComicInfo>");
  assert.ok(upscaleIdx < closingIdx);

  await rm(dir, { recursive: true });
});

test("tagFile - writes sidecar JSON for non-XML files", async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, "readme.txt");
  await writeFile(filePath, "hello");

  await tagFile(filePath, makeMeta());

  const sidecar = join(dir, "readme.txt.upscale-meta.json");
  const content = JSON.parse(await readFile(sidecar, "utf8"));
  assert.equal(content.engine, "waifu2x");
  assert.equal(content.scale, 2);
  assert.equal(content.noise, 1);

  await rm(dir, { recursive: true });
});

test("tagFile - escapes XML special characters in engine name", async () => {
  const dir = await makeTempDir();
  const xmlPath = join(dir, "meta.xml");
  await writeFile(xmlPath, "<Root></Root>");

  const meta = makeMeta();
  meta.engine = "test<>&\"engine";
  await tagFile(xmlPath, meta);

  const content = await readFile(xmlPath, "utf8");
  assert.ok(content.includes("&lt;&gt;&amp;&quot;"));

  await rm(dir, { recursive: true });
});
