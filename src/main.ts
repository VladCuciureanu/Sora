#!/usr/bin/env node
import { copyFile, mkdir, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig, type Config, type EngineConfig } from "./config.ts";
import { extractCbz, repackCbz, type CbzContents } from "./cbz.ts";
import { withTempContext } from "./temp.ts";
import type { UpscaleEngine } from "./engines/engine.ts";
import { createWaifu2xEngine } from "./engines/waifu2x.ts";
import { createUpscaleMetadata, tagFile } from "./metadata.ts";

const HELP = `Sora — Upscale CBZ comic book archives

Usage: sora <input.cbz> [options]

Options:
  -o, --output <path>     Output file (default: <input>_upscaled.cbz)
  -e, --engine <name>     Engine to use (default: waifu2x)
  -s, --scale <2|4>       Scale factor (default: 2)
  -n, --noise <-1..3>     Denoise level (default: -1, none)
  -j, --concurrency <N>   Parallel upscaling processes (default: 1)
  --config <path>         Config file path
  --dry-run               Show what would be done
  -h, --help              Show this help`;

export interface CliArgs {
  input: string;
  output: string;
  engine: string;
  scale: number;
  noise: number;
  concurrency?: number;
  configPath?: string;
  dryRun: boolean;
}

/** Invalid command-line usage; `main` reports it without a stack trace. */
export class UsageError extends Error {
  readonly showHelp: boolean;

  constructor(message: string, options: { showHelp?: boolean } = {}) {
    super(message);
    this.name = "UsageError";
    this.showHelp = options.showHelp ?? false;
  }
}

/**
 * Parse command-line arguments. Returns `null` when `--help` was requested.
 * Throws `UsageError` for invalid arguments.
 */
export function parseCliArgs(args: string[]): CliArgs | null {
  // strict: false: unknown flags are ignored and
  // option values may start with a dash (e.g. `-n -1`).
  const { values, positionals } = parseArgs({
    args,
    strict: false,
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      engine: { type: "string", short: "e", default: "waifu2x" },
      scale: { type: "string", short: "s", default: "2" },
      noise: { type: "string", short: "n", default: "-1" },
      concurrency: { type: "string", short: "j" },
      config: { type: "string" },
      help: { type: "boolean", short: "h" },
      "dry-run": { type: "boolean" },
    },
  });
  // With strict: false, a string option given without a value comes back as
  // `true`; treat it as an empty string.
  const str = (v: string | boolean | undefined) => (typeof v === "string" ? v : v ? "" : undefined);
  const parsed = {
    output: str(values.output),
    engine: str(values.engine),
    config: str(values.config),
    scale: values.scale,
    noise: values.noise,
    concurrency: values.concurrency,
    help: values.help,
    "dry-run": values["dry-run"] === true,
  };

  if (parsed.help) {
    return null;
  }

  const input = positionals[0];
  if (!input) {
    throw new UsageError("input CBZ file is required", { showHelp: true });
  }

  const scale = Number(parsed.scale);
  if (![2, 4].includes(scale)) {
    throw new UsageError("--scale must be 2 or 4");
  }

  const noise = Number(parsed.noise);
  if (![-1, 0, 1, 2, 3].includes(noise)) {
    throw new UsageError("--noise must be -1, 0, 1, 2, or 3");
  }

  const defaultOutput = join(
    dirname(input),
    basename(input, ".cbz") + "_upscaled.cbz",
  );

  const concurrency = parsed.concurrency != null ? Number(parsed.concurrency) : undefined;
  if (concurrency != null && (!Number.isInteger(concurrency) || concurrency < 1)) {
    throw new UsageError("--concurrency must be a positive integer");
  }

  return {
    input,
    output: parsed.output ?? defaultOutput,
    engine: parsed.engine ?? "waifu2x",
    scale,
    noise,
    concurrency,
    configPath: parsed.config,
    dryRun: parsed["dry-run"] ?? false,
  };
}

const ENGINES: Record<string, (config: EngineConfig) => UpscaleEngine> = {
  waifu2x: createWaifu2xEngine,
};

/**
 * Create the engine called `name` from its entry in `config`.
 * `concurrency`, when given, overrides the configured value.
 */
export function createEngine(name: string, config: Config, concurrency?: number): UpscaleEngine {
  const factory = Object.hasOwn(ENGINES, name) ? ENGINES[name] : undefined;
  if (!factory) {
    throw new Error(`Unknown engine "${name}". Available: ${Object.keys(ENGINES).join(", ")}`);
  }
  const engineConfig = Object.hasOwn(config.engines, name) ? config.engines[name] : undefined;
  if (!engineConfig) {
    throw new Error(`Engine "${name}" is not configured. Add it under "engines" in your config file.`);
  }
  return factory({ ...engineConfig, concurrency: concurrency ?? engineConfig.concurrency });
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args === null) {
    console.log(HELP);
    return;
  }

  const config = await loadConfig(args.configPath);
  const engine = createEngine(args.engine, config, args.concurrency);

  // Check engine availability
  const available = await engine.checkAvailable();
  if (!available) {
    throw new Error(
      `Engine "${args.engine}" binary not found or not executable.\n` +
        `Check the binaryPath in your config file.`,
    );
  }

  if (args.dryRun) {
    console.log("Dry run — would perform:");
    console.log(`  Input:  ${args.input}`);
    console.log(`  Output: ${args.output}`);
    console.log(`  Engine: ${args.engine}`);
    console.log(`  Scale:  ${args.scale}x`);
    console.log(`  Noise:  ${args.noise}`);
    console.log(`  Available engines: ${Object.keys(ENGINES).join(", ")}`);
    return;
  }

  // Check output doesn't exist (repackCbz also checks, but fail early)
  try {
    await stat(args.output);
    console.error(`Error: Output file already exists: ${args.output}`);
    process.exit(1);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  await upscaleCbz(args, engine);
}

/** Reads a CBZ into a directory and writes a directory back out as a CBZ. */
export interface ArchiveIO {
  extract(cbzPath: string, outputDir: string): Promise<CbzContents>;
  repack(sourceDir: string, outputPath: string): Promise<void>;
}

const zipArchive: ArchiveIO = { extract: extractCbz, repack: repackCbz };

/** Extract `args.input`, upscale its images with `engine`, and repack to `args.output`. */
export async function upscaleCbz(
  args: CliArgs,
  engine: UpscaleEngine,
  archive: ArchiveIO = zipArchive,
): Promise<void> {
  console.log(`Upscaling ${args.input}...`);
  console.log(`  Engine: ${args.engine} | Scale: ${args.scale}x | Noise: ${args.noise}`);

  await withTempContext(async (ctx) => {
    // Extract
    console.log("Extracting CBZ...");
    const contents = await archive.extract(args.input, ctx.inputDir);
    console.log(`  Found ${contents.imageFiles.length} images, ${contents.otherFiles.length} other files`);

    // Upscale images
    console.log("Upscaling images...");
    await engine.upscale(ctx.inputDir, ctx.outputDir, {
      scale: args.scale,
      noise: args.noise,
    });

    // Copy and tag non-image files
    const meta = createUpscaleMetadata(args.engine, args.scale, args.noise);
    for (const file of contents.otherFiles) {
      const src = join(ctx.inputDir, file);
      const dst = join(ctx.outputDir, file);
      await mkdir(dirname(dst), { recursive: true });
      await copyFile(src, dst);
      await tagFile(dst, meta);
    }

    // Repack
    console.log("Repacking CBZ...");
    await archive.repack(ctx.outputDir, args.output);
  });

  console.log(`Done! Output: ${args.output}`);
}

// Run main() only when executed directly (import.meta.main is not in all Node 24 releases).
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err: unknown) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof UsageError && err.showHelp) {
      console.error(`\n${HELP}`);
    }
    process.exitCode = 1;
  });
}
