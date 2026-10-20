import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const mainPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));

function runCli(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [mainPath, ...args], { encoding: "utf8", env });
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

test("cli - rejects an unknown --engine name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sora-test-"));
  try {
    const config = join(dir, "config.json");
    await writeFile(config, JSON.stringify({ engines: { waifu2x: { binaryPath: "waifu2x" } } }));
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

test("cli - an option value that looks like an option prints one line with a fix, exits 1", () => {
  const result = runCli(["in.cbz", "-o", "-dash.cbz"]);
  assert.equal(result.status, 1);
  assert.equal(
    result.stderr,
    "sora: option '-o' got '-dash.cbz', which looks like an option; write --output=-dash.cbz\n",
  );
  assert.equal(result.stdout, "");
});

test("cli - an option followed by another long option reports the missing value, exits 1", () => {
  const result = runCli(["in.cbz", "-o", "--dry-run"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "sora: option '--output' needs a value\n");
  assert.equal(result.stdout, "");
});

/** Write a config whose waifu2x binary is the running node executable, which exists. */
async function writeConfig(dir: string): Promise<string> {
  const config = join(dir, "config.json");
  await writeFile(
    config,
    JSON.stringify({ engines: { waifu2x: { binaryPath: process.execPath } } }),
  );
  return config;
}

test("cli - --dry-run fails when the input does not exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sora-test-"));
  try {
    const input = join(dir, "missing.cbz");
    const result = runCli([input, "--config", await writeConfig(dir), "--dry-run"]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, `sora: Input file not found: ${input}\n`);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("cli - --dry-run prints the plan without listing engines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sora-test-"));
  try {
    const input = join(dir, "comic.cbz");
    await writeFile(input, "");
    const result = runCli([input, "--config", await writeConfig(dir), "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Dry run/);
    assert.match(result.stdout, /Output: .*comic_upscaled\.cbz$/m);
    assert.doesNotMatch(result.stdout, /Available engines/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("cli - --help shows the default config paths in the order they are tried", () => {
  const xdg = join(tmpdir(), "sora-xdg");
  const home = join(tmpdir(), "sora-home");
  const result = runCli(["--help"], { ...process.env, XDG_CONFIG_HOME: xdg, HOME: home });
  assert.equal(result.status, 0);
  const xdgPath = join(xdg, "sora", "config.json");
  const homePath = join(home, ".config", "sora", "config.json");
  const configLine = result.stdout.split("\n").find((line) => line.includes("--config")) ?? "";
  assert.ok(configLine.endsWith(`(default: ${xdgPath}, else ${homePath})`), configLine);
});

test("cli - a missing waifu2x binary is reported on one line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sora-test-"));
  try {
    const binary = join(dir, "waifu2x-ncnn-vulkan");
    const config = join(dir, "config.json");
    await writeFile(config, JSON.stringify({ engines: { waifu2x: { binaryPath: binary } } }));
    const result = runCli([join(dir, "in.cbz"), "--config", config]);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr,
      `sora: waifu2x binary not found or not executable: ${binary}. Check binaryPath in ${config}
`,
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("cli - falls back to ~/.config when XDG_CONFIG_HOME has no config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sora-test-"));
  try {
    const home = join(dir, "home");
    const config = join(home, ".config", "sora", "config.json");
    const binary = join(dir, "missing-waifu2x");
    await mkdir(dirname(config), { recursive: true });
    await writeFile(config, JSON.stringify({ engines: { waifu2x: { binaryPath: binary } } }));
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(dir, "xdg") };
    const result = runCli([join(dir, "in.cbz")], env);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.trim(),
      `sora: waifu2x binary not found or not executable: ${binary}. Check binaryPath in ${config}`,
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});
