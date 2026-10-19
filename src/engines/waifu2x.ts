import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import type { UpscaleEngine, UpscaleOpts } from "./engine.ts";
import { isImageFile } from "../cbz.ts";
import { run, type RunResult } from "../exec.ts";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 1;

export interface Waifu2xConfig {
  binaryPath: string;
  batchSize?: number;
  concurrency?: number;
  /** Process runner; overridable for tests. Defaults to `run` from exec.ts. */
  runner?: (command: string, args: string[]) => Promise<RunResult>;
}

export function createWaifu2xEngine(config: Waifu2xConfig): UpscaleEngine {
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  const runner = config.runner ?? run;

  return {
    name: "waifu2x",

    async checkAvailable(): Promise<boolean> {
      try {
        const info = await stat(config.binaryPath);
        return info.isFile();
      } catch {
        return false;
      }
    },

    async upscale(inputDir: string, outputDir: string, opts: UpscaleOpts): Promise<void> {
      const files = await collectImageFiles(inputDir);
      if (files.length === 0) {
        throw new Error("No image files found to upscale");
      }

      const batches = splitIntoBatches(files, batchSize);
      let processed = 0;
      const total = files.length;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`  Batch ${i + 1}/${batches.length} (${batch.length} images)...`);
        await runWaifu2xBatch(runner, config.binaryPath, inputDir, outputDir, batch, opts, concurrency, (file) => {
          processed++;
          const pct = Math.round((processed / total) * 100);
          process.stdout.write(`\r  [${pct}%] ${processed}/${total} — ${file}`);
        });
        console.log(); // newline after batch
      }
    },
  };
}

/** Recursively collect image files under `dir`, as paths relative to `dir`. */
export async function collectImageFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && isImageFile(entry.name)) {
      files.push(relative(dir, join(entry.parentPath, entry.name)));
    }
  }
  return files.sort();
}

export function splitIntoBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

export function buildWaifu2xArgs(
  inputPath: string,
  outputPath: string,
  opts: UpscaleOpts,
): string[] {
  const args = ["-i", inputPath, "-o", outputPath, "-s", String(opts.scale)];
  if (opts.noise >= 0) {
    args.push("-n", String(opts.noise));
  }
  return args;
}

async function runWaifu2xBatch(
  runner: (command: string, args: string[]) => Promise<RunResult>,
  binaryPath: string,
  inputDir: string,
  outputDir: string,
  files: string[],
  opts: UpscaleOpts,
  concurrency: number,
  onFile?: (file: string) => void,
): Promise<void> {
  async function processFile(file: string): Promise<void> {
    const inputPath = join(inputDir, file);
    const outputPath = join(outputDir, file);
    const args = buildWaifu2xArgs(inputPath, outputPath, opts);

    await mkdir(dirname(outputPath), { recursive: true });
    const result = await runner(binaryPath, args);
    if (!result.success) {
      throw new Error(`waifu2x failed on ${file}: ${result.stderr}`);
    }
    onFile?.(file);
  }

  await runPool(files, concurrency, processFile);
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
