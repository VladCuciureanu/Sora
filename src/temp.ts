export interface TempContext {
  inputDir: string;
  outputDir: string;
  cleanup(): Promise<void>;
}

export async function createTempContext(prefix = "cbz-upscale"): Promise<TempContext> {
  const inputDir = await Deno.makeTempDir({ prefix: `${prefix}-in-` });
  const outputDir = await Deno.makeTempDir({ prefix: `${prefix}-out-` });

  const cleanup = async () => {
    await Deno.remove(inputDir, { recursive: true }).catch(() => {});
    await Deno.remove(outputDir, { recursive: true }).catch(() => {});
  };

  return { inputDir, outputDir, cleanup };
}

export async function withTempContext<T>(
  fn: (ctx: TempContext) => Promise<T>,
  prefix?: string,
): Promise<T> {
  const ctx = await createTempContext(prefix);
  try {
    return await fn(ctx);
  } finally {
    await ctx.cleanup();
  }
}
