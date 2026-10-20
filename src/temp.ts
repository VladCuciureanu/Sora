import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempContext {
  inputDir: string;
  outputDir: string;
  cleanup(): Promise<void>;
}

export async function createTempContext(): Promise<TempContext> {
  const inputDir = await mkdtemp(join(tmpdir(), "sora-in-"));
  const outputDir = await mkdtemp(join(tmpdir(), "sora-out-"));

  const cleanup = async () => {
    await rm(inputDir, { recursive: true }).catch(() => {});
    await rm(outputDir, { recursive: true }).catch(() => {});
  };

  return { inputDir, outputDir, cleanup };
}

export async function withTempContext<T>(fn: (ctx: TempContext) => Promise<T>): Promise<T> {
  const ctx = await createTempContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.cleanup();
  }
}
