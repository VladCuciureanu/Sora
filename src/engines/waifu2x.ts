import { join } from "@std/path";
import type { UpscaleEngine, UpscaleOpts } from "./engine.ts";
import { isImageFile } from "../cbz.ts";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 1;

export interface Waifu2xConfig {
  binaryPath: string;
  batchSize?: number;
  concurrency?: number;
}

export function createWaifu2xEngine(config: Waifu2xConfig): UpscaleEngine {
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;

  return {
    name: "waifu2x",

    async checkAvailable(): Promise<boolean> {
      try {
        const stat = await Deno.stat(config.binaryPath);
        return stat.isFile;
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
        await runWaifu2xBatch(config.binaryPath, inputDir, outputDir, batch, opts, concurrency, (file) => {
          processed++;
          const pct = Math.round((processed / total) * 100);
          const encoder = new TextEncoder();
          Deno.stdout.writeSync(encoder.encode(`\r  [${pct}%] ${processed}/${total} — ${file}`));
        });
        console.log(); // newline after batch
      }
    },
  };
}

async function collectImageFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && isImageFile(entry.name)) {
      files.push(entry.name);
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

    const cmd = new Deno.Command(binaryPath, {
      args,
      stdout: "piped",
      stderr: "piped",
    });

    const result = await cmd.output();
    if (!result.success) {
      const stderr = new TextDecoder().decode(result.stderr);
      throw new Error(`waifu2x failed on ${file}: ${stderr}`);
    }
    onFile?.(file);
  }

  if (concurrency <= 1) {
    for (const file of files) {
      await processFile(file);
    }
    return;
  }

  const executing = new Set<Promise<void>>();
  for (const file of files) {
    const p = processFile(file).then(
      () => { executing.delete(p); },
      (err) => { executing.delete(p); throw err; },
    );
    executing.add(p);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}
