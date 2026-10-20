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

function validateConfig(data: unknown): Config {
  if (typeof data !== "object" || data === null) {
    throw new Error("Config must be a JSON object");
  }

  const obj = data as Record<string, unknown>;
  if (typeof obj.engines !== "object" || obj.engines === null) {
    throw new Error('Config must have an "engines" object');
  }

  const engines = obj.engines as Record<string, unknown>;
  for (const [name, engine] of Object.entries(engines)) {
    if (typeof engine !== "object" || engine === null) {
      throw new Error(`Engine "${name}" must be an object`);
    }
    const eng = engine as Record<string, unknown>;
    if (typeof eng.binaryPath !== "string" || eng.binaryPath.length === 0) {
      throw new Error(`Engine "${name}" must have a non-empty "binaryPath" string`);
    }
  }

  return { engines: engines as Record<string, EngineConfig> };
}
