import { assertEquals, assertStringIncludes, assert } from "@std/assert";
import { join } from "@std/path";
import { createUpscaleMetadata, tagFile } from "../src/metadata.ts";
import type { UpscaleMetadata } from "../src/metadata.ts";

function makeMeta(): UpscaleMetadata {
  return {
    engine: "waifu2x",
    scale: 2,
    noise: 1,
    timestamp: "2025-01-01T00:00:00.000Z",
  };
}

Deno.test("createUpscaleMetadata - creates metadata with timestamp", () => {
  const meta = createUpscaleMetadata("waifu2x", 2, -1);
  assertEquals(meta.engine, "waifu2x");
  assertEquals(meta.scale, 2);
  assertEquals(meta.noise, -1);
  assert(meta.timestamp.length > 0);
});

Deno.test("tagFile - injects metadata into XML file", async () => {
  const dir = await Deno.makeTempDir();
  const xmlPath = join(dir, "ComicInfo.xml");
  await Deno.writeTextFile(xmlPath, `<?xml version="1.0"?>\n<ComicInfo>\n  <Title>Test</Title>\n</ComicInfo>`);

  await tagFile(xmlPath, makeMeta());

  const content = await Deno.readTextFile(xmlPath);
  assertStringIncludes(content, "<UpscaleInfo>");
  assertStringIncludes(content, "<Engine>waifu2x</Engine>");
  assertStringIncludes(content, "<Scale>2</Scale>");
  assertStringIncludes(content, "<Noise>1</Noise>");
  // Ensure it's before the closing tag
  const upscaleIdx = content.indexOf("<UpscaleInfo>");
  const closingIdx = content.indexOf("</ComicInfo>");
  assert(upscaleIdx < closingIdx);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("tagFile - writes sidecar JSON for non-XML files", async () => {
  const dir = await Deno.makeTempDir();
  const filePath = join(dir, "readme.txt");
  await Deno.writeTextFile(filePath, "hello");

  await tagFile(filePath, makeMeta());

  const sidecar = join(dir, "readme.txt.upscale-meta.json");
  const content = JSON.parse(await Deno.readTextFile(sidecar));
  assertEquals(content.engine, "waifu2x");
  assertEquals(content.scale, 2);
  assertEquals(content.noise, 1);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("tagFile - escapes XML special characters in engine name", async () => {
  const dir = await Deno.makeTempDir();
  const xmlPath = join(dir, "meta.xml");
  await Deno.writeTextFile(xmlPath, "<Root></Root>");

  const meta = makeMeta();
  meta.engine = "test<>&\"engine";
  await tagFile(xmlPath, meta);

  const content = await Deno.readTextFile(xmlPath);
  assertStringIncludes(content, "&lt;&gt;&amp;&quot;");

  await Deno.remove(dir, { recursive: true });
});
