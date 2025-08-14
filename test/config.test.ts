import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { loadConfig } from "../src/config.ts";

Deno.test("loadConfig - loads valid config", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/config.json`;
  await Deno.writeTextFile(
    path,
    JSON.stringify({
      engines: {
        waifu2x: { binaryPath: "/usr/local/bin/waifu2x-ncnn-vulkan" },
      },
    }),
  );

  const config = await loadConfig(path);
  assertEquals(config.engines.waifu2x.binaryPath, "/usr/local/bin/waifu2x-ncnn-vulkan");

  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadConfig - throws on missing file with setup instructions", async () => {
  const err = await assertRejects(
    () => loadConfig("/tmp/nonexistent/config.json"),
    Error,
  );
  assertStringIncludes(err.message, "Config file not found");
  assertStringIncludes(err.message, "mkdir -p");
});

Deno.test("loadConfig - throws on invalid JSON", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/config.json`;
  await Deno.writeTextFile(path, "not json{");

  await assertRejects(
    () => loadConfig(path),
    Error,
    "not valid JSON",
  );

  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadConfig - throws on missing engines key", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/config.json`;
  await Deno.writeTextFile(path, JSON.stringify({ foo: "bar" }));

  await assertRejects(
    () => loadConfig(path),
    Error,
    '"engines" object',
  );

  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadConfig - throws on engine without binaryPath", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/config.json`;
  await Deno.writeTextFile(
    path,
    JSON.stringify({ engines: { waifu2x: {} } }),
  );

  await assertRejects(
    () => loadConfig(path),
    Error,
    "binaryPath",
  );

  await Deno.remove(dir, { recursive: true });
});
