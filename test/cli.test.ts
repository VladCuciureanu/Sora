import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
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
    assert.match(result.stderr, /^Error: Config file not found/);
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
  assert.match(result.stderr, /^Error: input CBZ file is required/);
  assert.match(result.stderr, /^Usage: sora/m);
  assert.doesNotMatch(result.stderr, /^\s+at /m);
});

test("cli - invalid option value prints the error only, exits 1", () => {
  const result = runCli(["in.cbz", "-s", "3"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "Error: --scale must be 2 or 4");
});
