import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import process from "node:process";

export interface EngineConfig {
  binaryPath: string;
  concurrency?: number;
}

export interface Config {
  engines: Record<string, EngineConfig>;
}

/**
 * The default config file locations, in the order they are tried:
 * `$XDG_CONFIG_HOME/sora/config.json` (only when XDG_CONFIG_HOME is an absolute
 * path, as the XDG spec requires), then `~/.config/sora/config.json`.
 */
export function defaultConfigPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = join(env.HOME ?? env.USERPROFILE ?? ".", ".config", "sora", "config.json");
  const xdg = env.XDG_CONFIG_HOME;
  if (!xdg || !isAbsolute(xdg)) {
    return [home];
  }
  const xdgPath = join(xdg, "sora", "config.json");
  return xdgPath === home ? [home] : [xdgPath, home];
}

/** Setup instructions for creating `checked[0]`, naming every path that was checked. */
function notFoundError(checked: string[]): Error {
  const path = checked[0];
  const where =
    checked.length === 1
      ? `Config file not found at ${path}`
      : `Config file not found. Looked in:\n${checked.map((p) => `  ${p}`).join("\n")}`;
  return new Error(
    `${where}\n\n` +
      `Create it with:\n` +
      `  mkdir -p "${dirname(path)}"\n` +
      `  cat > "${path}" << 'EOF'\n` +
      `  {\n` +
      `    "engines": {\n` +
      `      "waifu2x": { "binaryPath": "/path/to/waifu2x-ncnn-vulkan" }\n` +
      `    }\n` +
      `  }\n` +
      `  EOF`,
  );
}

function isNotFound(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Return the first of `defaultConfigPaths(env)` that is a regular file. Throws
 * with setup instructions, listing every path checked, if none is.
 */
export async function findConfigPath(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const candidates = defaultConfigPaths(env);
  for (const path of candidates) {
    try {
      if ((await stat(path)).isFile()) return path;
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }
  throw notFoundError(candidates);
}

/** Load `configPath`, or the file `findConfigPath(env)` finds when it is omitted. */
export async function loadConfig(
  configPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Config> {
  const path = configPath ?? (await findConfigPath(env));

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if (isNotFound(e)) {
      throw notFoundError([path]);
    }
    if ((e as NodeJS.ErrnoException).code === "EISDIR") {
      throw new Error(`Config path ${path} is a directory, not a file`);
    }
    throw e;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Config file at ${path} is not valid JSON`);
  }

  return validateConfig(parsed);
}

/** Engines Sora knows how to run. */
export const ENGINE_NAMES: readonly string[] = ["waifu2x"];
const ENGINE_KEYS = ["binaryPath", "concurrency"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateConfig(data: unknown): Config {
  if (!isObject(data)) {
    throw new Error("Config must be a JSON object");
  }
  if (!isObject(data.engines)) {
    throw new Error('Config must have an "engines" object');
  }
  for (const key of Object.keys(data)) {
    if (key !== "engines") {
      throw new Error(`Unknown config key "${key}"`);
    }
  }

  const engines = data.engines;
  for (const [name, engine] of Object.entries(engines)) {
    if (!ENGINE_NAMES.includes(name)) {
      throw new Error(`Unknown engine "${name}" in config. Available: ${ENGINE_NAMES.join(", ")}`);
    }
    if (!isObject(engine)) {
      throw new Error(`Engine "${name}" must be an object`);
    }
    for (const key of Object.keys(engine)) {
      if (!ENGINE_KEYS.includes(key)) {
        throw new Error(`Engine "${name}": unknown key "${key}"`);
      }
    }
    if (typeof engine.binaryPath !== "string" || engine.binaryPath.length === 0) {
      throw new Error(`Engine "${name}" must have a non-empty "binaryPath" string`);
    }
    const { concurrency } = engine;
    if (
      concurrency !== undefined &&
      !(typeof concurrency === "number" && Number.isInteger(concurrency) && concurrency > 0)
    ) {
      throw new Error(`Engine "${name}": "concurrency" must be a positive integer`);
    }
  }

  return { engines: engines as Record<string, EngineConfig> };
}
