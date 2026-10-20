import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { isImageFile } from "../cbz.ts";
import { type RunResult, run } from "../exec.ts";
import type { UpscaleEngine, UpscaleOpts } from "./engine.ts";

const DEFAULT_CONCURRENCY = 1;

export interface Waifu2xConfig {
  binaryPath: string;
  concurrency?: number;
  /** Process runner; overridable for tests. Defaults to `run` from exec.ts. */
  runner?: (command: string, args: string[]) => Promise<RunResult>;
}

export function createWaifu2xEngine(config: Waifu2xConfig): UpscaleEngine {
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

      let processed = 0;
      const total = files.length;

      async function processFile(file: string): Promise<void> {
        const inputPath = join(inputDir, file);
        const outputPath = join(outputDir, file);
        await mkdir(dirname(outputPath), { recursive: true });
        const result = await runner(
          config.binaryPath,
          buildWaifu2xArgs(inputPath, outputPath, opts),
        );
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
