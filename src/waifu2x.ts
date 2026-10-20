import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { run as defaultRun, type Runner } from "./exec.ts";

const DEFAULT_CONCURRENCY = 1;

export interface Waifu2xOptions {
  binaryPath: string;
  scale: number;
  noise: number;
  concurrency?: number;
  /** Runs the waifu2x process; tests substitute a fake. */
  run?: Runner;
}

/** Whether `binaryPath` points at a usable waifu2x binary. */
export async function isWaifu2xAvailable(binaryPath: string): Promise<boolean> {
  try {
    const info = await stat(binaryPath);
    return info.isFile();
  } catch {
    return false;
  }
}

/**
 * Upscale `files` (paths relative to `inputDir`) into the same relative paths
 * under `outputDir`.
 */
export async function upscaleImages(
  inputDir: string,
  outputDir: string,
  files: string[],
  options: Waifu2xOptions,
): Promise<void> {
  const { binaryPath, concurrency = DEFAULT_CONCURRENCY, run = defaultRun } = options;
  if (files.length === 0) {
    throw new Error("No image files found to upscale");
  }

  let processed = 0;
  const total = files.length;

  async function processFile(file: string): Promise<void> {
    const inputPath = join(inputDir, file);
    const outputPath = join(outputDir, file);
    await mkdir(dirname(outputPath), { recursive: true });
    const result = await run(binaryPath, buildWaifu2xArgs(inputPath, outputPath, options));
    if (!result.success) {
      throw new Error(`waifu2x failed on ${file}: ${result.stderr}`);
    }
    processed++;
    const pct = Math.round((processed / total) * 100);
    process.stdout.write(`\r  [${pct}%] ${processed}/${total} — ${file}`);
  }

  try {
    await runPool(files, concurrency, processFile);
  } finally {
    if (processed > 0) console.log(); // end the progress line
  }
}

export function buildWaifu2xArgs(
  inputPath: string,
  outputPath: string,
  opts: { scale: number; noise: number },
): string[] {
  const args = ["-i", inputPath, "-o", outputPath, "-s", String(opts.scale)];
  if (opts.noise >= 0) {
    args.push("-n", String(opts.noise));
  }
  return args;
}

/**
 * Run `task` over `items` with at most `concurrency` tasks in flight.
 * On the first failure no new tasks are started, but every in-flight task
 * is awaited before the pool rejects with that first error, so no task is
 * left running or rejecting unobserved.
 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed = false;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (!failed && next < items.length) {
      const item = items[next++];
      try {
        await task(item);
      } catch (err) {
        if (!failed) {
          failed = true;
          firstError = err;
        }
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  if (failed) {
    throw firstError;
  }
}
