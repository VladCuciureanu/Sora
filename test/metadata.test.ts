import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUpscaleMetadata, METADATA_FILENAME, writeUpscaleMetadata } from "../src/metadata.ts";
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

test("writeUpscaleMetadata - writes sora.upscale.json in the given directory", async () => {
  const dir = await makeTempDir();
  try {
    assert.equal(METADATA_FILENAME, "sora.upscale.json");
    await writeUpscaleMetadata(dir, makeMeta());
    const content = JSON.parse(await readFile(join(dir, METADATA_FILENAME), "utf8"));
    assert.deepEqual(content, makeMeta());
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("writeUpscaleMetadata - replaces an existing metadata file", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, METADATA_FILENAME), '{"engine":"old"}');
    await writeUpscaleMetadata(dir, makeMeta());
    const content = JSON.parse(await readFile(join(dir, METADATA_FILENAME), "utf8"));
    assert.equal(content.engine, "waifu2x");
  } finally {
    await rm(dir, { recursive: true });
  }
});
