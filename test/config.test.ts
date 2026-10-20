import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { defaultConfigPath, loadConfig } from "../src/config.ts";

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

test("loadConfig - setup instructions name the path that was looked for", async () => {
  const path = join(tmpdir(), "sora-nonexistent", "custom.json");
  await assert.rejects(
    () => loadConfig(path),
    (err: Error) => {
      assert.match(err.message, new RegExp(`mkdir -p "${RegExp.escape(dirname(path))}"`));
      assert.match(err.message, new RegExp(`cat > "${RegExp.escape(path)}"`));
      assert.doesNotMatch(err.message, /~\/\.config/);
      return true;
    },
  );
});

test("defaultConfigPath - uses XDG_CONFIG_HOME when it is an absolute path", () => {
  const xdg = resolve("xdg-config");
  const home = resolve("home");
  assert.equal(
    defaultConfigPath({ XDG_CONFIG_HOME: xdg, HOME: home }),
    join(xdg, "sora", "config.json"),
  );
});

test("defaultConfigPath - falls back to ~/.config if XDG_CONFIG_HOME is unset, empty or relative", () => {
  const home = resolve("home");
  const fallback = join(home, ".config", "sora", "config.json");
  assert.equal(defaultConfigPath({ HOME: home }), fallback);
  assert.equal(defaultConfigPath({ XDG_CONFIG_HOME: "", HOME: home }), fallback);
  assert.equal(defaultConfigPath({ XDG_CONFIG_HOME: "relative", HOME: home }), fallback);
});

async function loadConfigJson(data: unknown) {
  const dir = await makeTempDir();
  try {
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify(data));
    return await loadConfig(path);
  } finally {
    await rm(dir, { recursive: true });
  }
}

test("loadConfig - accepts a positive integer concurrency", async () => {
  const config = await loadConfigJson({
    engines: { waifu2x: { binaryPath: waifu2xPath, concurrency: 2 } },
  });
  assert.equal(config.engines.waifu2x?.concurrency, 2);
});

for (const concurrency of ["2", 0, -1, 1.5, null]) {
  test(`loadConfig - rejects concurrency ${JSON.stringify(concurrency)}`, async () => {
    await assert.rejects(
      () => loadConfigJson({ engines: { waifu2x: { binaryPath: waifu2xPath, concurrency } } }),
      { message: 'Engine "waifu2x": "concurrency" must be a positive integer' },
    );
  });
}

for (const [name, data, message] of [
  [
    "an unknown top-level key",
    { engines: { waifu2x: { binaryPath: waifu2xPath } }, engine: "waifu2x" },
    'Unknown config key "engine"',
  ],
  [
    "an unknown engine key",
    { engines: { waifu2x: { binaryPath: waifu2xPath, concurency: 2 } } },
    'Engine "waifu2x": unknown key "concurency"',
  ],
  [
    "an unknown engine",
    { engines: { waifu2x: { binaryPath: waifu2xPath }, realesrgan: { binaryPath: "x" } } },
    'Unknown engine "realesrgan" in config. Available: waifu2x',
  ],
  ["an engines array", { engines: [] }, 'Config must have an "engines" object'],
] as const) {
  test(`loadConfig - rejects ${name}`, async () => {
    await assert.rejects(() => loadConfigJson(data), { message });
  });
}
