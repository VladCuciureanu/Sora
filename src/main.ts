#!/usr/bin/env node
import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { extractCbz, repackCbz } from "./cbz.ts";
import { type EngineConfig, loadConfig } from "./config.ts";
import type { Runner } from "./exec.ts";
import { createUpscaleMetadata, writeUpscaleMetadata } from "./metadata.ts";
import { withTempContext } from "./temp.ts";
import { isWaifu2xAvailable, upscaleImages } from "./waifu2x.ts";

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

function parseOptions(args: string[]) {
  return parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      engine: { type: "string", short: "e", default: "waifu2x" },
      scale: { type: "string", short: "s", default: "2" },
      noise: { type: "string", short: "n", default: "-1" },
      concurrency: { type: "string", short: "j" },
      config: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
}

/**
 * Strict parseArgs rejects option values that start with a dash, so rewrite
 * `-n -1` and `--noise -1` as `--noise=-1`. Arguments after `--` are left alone.
 */
function joinNegativeNoise(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      result.push(...args.slice(i));
      break;
    }
    if ((arg === "-n" || arg === "--noise") && /^-\d/.test(args[i + 1] ?? "")) {
      result.push(`--noise=${args[++i]}`);
    } else {
      result.push(arg);
    }
  }
  return result;
}

/**
 * Parse command-line arguments. Returns `null` when `--help` was requested.
 * Throws `UsageError` for invalid arguments.
 */
export function parseCliArgs(args: string[]): CliArgs | null {
  let parsed: ReturnType<typeof parseOptions>;
  try {
    parsed = parseOptions(joinNegativeNoise(args));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS_")) {
      // Keep only the first sentence: Node appends multi-line hints.
      throw new UsageError((err as Error).message.split(/\.\s/)[0]);
    }
    throw err;
  }
  const { values, positionals } = parsed;

  if (values.help) {
    return null;
  }

  const [input, ...extra] = positionals;
  if (!input) {
    throw new UsageError("input CBZ file is required", { showHelp: true });
  }
  if (extra.length > 0) {
    throw new UsageError(`Unexpected argument: ${extra[0]}`);
  }

  const scale = Number(values.scale);
  if (![2, 4].includes(scale)) {
    throw new UsageError("--scale must be 2 or 4");
  }

  const noise = Number(values.noise);
  if (![-1, 0, 1, 2, 3].includes(noise)) {
    throw new UsageError("--noise must be -1, 0, 1, 2, or 3");
  }

  const concurrency = values.concurrency === undefined ? undefined : Number(values.concurrency);
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
    throw new UsageError("--concurrency must be a positive integer");
  }

  return {
    input,
    output: values.output ?? join(dirname(input), `${basename(input, ".cbz")}_upscaled.cbz`),
    engine: values.engine,
    scale,
    noise,
    concurrency,
    configPath: values.config,
    dryRun: values["dry-run"],
  };
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args === null) {
    console.log(HELP);
    return;
  }

  const config = await loadConfig(args.configPath);
  if (args.engine !== "waifu2x") {
    throw new Error(`Unknown engine "${args.engine}". Available: waifu2x`);
  }
  const engine = config.engines.waifu2x;
  if (!engine) {
    throw new Error(
      `Engine "${args.engine}" is not configured. Add it under "engines" in your config file.`,
    );
  }

  if (!(await isWaifu2xAvailable(engine.binaryPath))) {
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
    console.log(`  Available engines: waifu2x`);
    return;
  }

  await upscaleCbz(args, engine);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

/**
 * Extract `args.input`, upscale its images with the waifu2x binary in `engine`,
 * and repack to `args.output`. `args.concurrency` overrides `engine.concurrency`.
 */
export async function upscaleCbz(
  args: CliArgs,
  engine: EngineConfig,
  options: {
    /** Runs unzip, waifu2x and zip; tests substitute a fake. */
    run?: Runner;
  } = {},
): Promise<void> {
  const { run } = options;
  // Fail before doing any work rather than after upscaling every page.
  if (await pathExists(args.output)) {
    throw new Error(`Output file already exists: ${args.output}`);
  }

  console.log(`Upscaling ${args.input}...`);
  console.log(`  Engine: ${args.engine} | Scale: ${args.scale}x | Noise: ${args.noise}`);

  await withTempContext(async (ctx) => {
    // Extract
    console.log("Extracting CBZ...");
    const contents = await extractCbz(args.input, ctx.inputDir, { run });
    console.log(
      `  Found ${contents.imageFiles.length} images, ${contents.otherFiles.length} other files`,
    );

    // Upscale images
    console.log("Upscaling images...");
    await upscaleImages(ctx.inputDir, ctx.outputDir, contents.imageFiles, {
      binaryPath: engine.binaryPath,
      scale: args.scale,
      noise: args.noise,
      concurrency: args.concurrency ?? engine.concurrency,
      run,
    });

    // Copy non-image files unchanged, then record how the archive was upscaled
    for (const file of contents.otherFiles) {
      const src = join(ctx.inputDir, file);
      const dst = join(ctx.outputDir, file);
      await mkdir(dirname(dst), { recursive: true });
      await copyFile(src, dst);
    }
    await writeUpscaleMetadata(
      ctx.outputDir,
      createUpscaleMetadata(args.engine, args.scale, args.noise),
    );

    // Repack
    console.log("Repacking CBZ...");
    await repackCbz(ctx.outputDir, args.output, { run });
  });

  console.log(`Done! Output: ${args.output}`);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(`sora: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof UsageError && err.showHelp) {
      console.error(`\n${HELP}`);
    }
    process.exitCode = 1;
  });
}
