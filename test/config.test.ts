import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";

const makeTempDir = () => mkdtemp(join(tmpdir(), "sora-test-"));
const waifu2xPath = join("usr", "local", "bin", "waifu2x-ncnn-vulkan");

test("loadConfig - loads valid config", async () => {
  const dir = await makeTempDir();
  const path = join(dir, "config.json");
  await writeFile(
    path,
    JSON.stringify({
      engines: {
        waifu2x: { binaryPath: waifu2xPath },
      },
    }),
  );

  const config = await loadConfig(path);
  assert.equal(config.engines.waifu2x.binaryPath, waifu2xPath);

  await rm(dir, { recursive: true });
});

test("loadConfig - throws on missing file with setup instructions", async () => {
  await assert.rejects(
    () => loadConfig(join(tmpdir(), "sora-nonexistent", "config.json")),
    (err: Error) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Config file not found/);
      assert.match(err.message, /mkdir -p/);
      return true;
    },
  );
});

test("loadConfig - throws on invalid JSON", async () => {
  const dir = await makeTempDir();
  const path = join(dir, "config.json");
  await writeFile(path, "not json{");

  await assert.rejects(() => loadConfig(path), { name: "Error", message: /not valid JSON/ });

  await rm(dir, { recursive: true });
});

test("loadConfig - throws on missing engines key", async () => {
  const dir = await makeTempDir();
  const path = join(dir, "config.json");
  await writeFile(path, JSON.stringify({ foo: "bar" }));

  await assert.rejects(() => loadConfig(path), { name: "Error", message: /"engines" object/ });

  await rm(dir, { recursive: true });
});

test("loadConfig - throws on engine without binaryPath", async () => {
  const dir = await makeTempDir();
  const path = join(dir, "config.json");
  await writeFile(path, JSON.stringify({ engines: { waifu2x: {} } }));

  await assert.rejects(() => loadConfig(path), { name: "Error", message: /binaryPath/ });

  await rm(dir, { recursive: true });
});
