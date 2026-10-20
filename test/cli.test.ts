import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const mainPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));

function runCli(args: string[]) {
  return spawnSync(process.execPath, [mainPath, ...args], { encoding: "utf8" });
}

test("cli - runtime errors print a message without a stack trace and exit 1", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sora-test-"));
  try {
    const result = runCli([join(dir, "in.cbz"), "--config", join(dir, "missing.json")]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^sora: Config file not found/);
    assert.doesNotMatch(result.stderr, /^\s+at /m);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("cli - --help prints usage to stdout and exits 0", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Usage: sora/m);
  assert.equal(result.stderr, "");
});

test("cli - missing input prints the error and usage, exits 1", () => {
  const result = runCli([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^sora: input CBZ file is required/);
  assert.match(result.stderr, /^Usage: sora/m);
  assert.doesNotMatch(result.stderr, /^\s+at /m);
});

test("cli - invalid option value prints the error only, exits 1", () => {
  const result = runCli(["in.cbz", "-s", "3"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "sora: --scale must be 2 or 4");
});

test("cli - rejects an unknown engine name even if configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sora-test-"));
  try {
    const config = join(dir, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        engines: { waifu2x: { binaryPath: "waifu2x" }, realesrgan: { binaryPath: "realesrgan" } },
      }),
    );
    const result = runCli([join(dir, "in.cbz"), "--config", config, "-e", "realesrgan"]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), 'sora: Unknown engine "realesrgan". Available: waifu2x');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("cli - rejects waifu2x when it is missing from the config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sora-test-"));
  try {
    const config = join(dir, "config.json");
    await writeFile(config, JSON.stringify({ engines: {} }));
    const result = runCli([join(dir, "in.cbz"), "--config", config]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^sora: Engine "waifu2x" is not configured/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("cli - unknown option prints one error line, exits 1", () => {
  const result = runCli(["in.cbz", "--scal", "4"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "sora: Unknown option '--scal'\n");
  assert.equal(result.stdout, "");
});
