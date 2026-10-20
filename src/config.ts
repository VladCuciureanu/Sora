import { readFile } from "node:fs/promises";
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
 * `$XDG_CONFIG_HOME/sora/config.json`, or `~/.config/sora/config.json` when
 * XDG_CONFIG_HOME is unset, empty or relative (as the XDG spec requires).
 */
export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const configHome =
    xdg && isAbsolute(xdg) ? xdg : join(env.HOME ?? env.USERPROFILE ?? ".", ".config");
  return join(configHome, "sora", "config.json");
}

export async function loadConfig(configPath?: string): Promise<Config> {
  const path = configPath ?? defaultConfigPath();

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Config file not found at ${path}\n\n` +
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

const ENGINE_NAMES = ["waifu2x"];
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
