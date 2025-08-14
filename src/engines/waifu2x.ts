import { join } from "@std/path";
import type { UpscaleEngine, UpscaleOpts } from "./engine.ts";
import { isImageFile } from "../cbz.ts";

const DEFAULT_BATCH_SIZE = 50;

export interface Waifu2xConfig {
  binaryPath: string;
  batchSize?: number;
}

export function createWaifu2xEngine(config: Waifu2xConfig): UpscaleEngine {
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;

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

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`  Batch ${i + 1}/${batches.length} (${batch.length} images)...`);
        await runWaifu2xBatch(config.binaryPath, inputDir, outputDir, batch, opts);
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
): Promise<void> {
  // waifu2x-ncnn-vulkan supports directory input/output, but for batching
  // we process individual files
  for (const file of files) {
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
  }
}
