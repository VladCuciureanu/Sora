import { parseArgs } from "@std/cli/parse-args";
import { basename, dirname, join } from "@std/path";
import { loadConfig } from "./config.ts";
import { extractCbz, repackCbz } from "./cbz.ts";
import { withTempContext } from "./temp.ts";
import { registerEngine, getEngine, listEngines } from "./engines/engine.ts";
import { createWaifu2xEngine } from "./engines/waifu2x.ts";
import { createUpscaleMetadata, tagFile } from "./metadata.ts";

const HELP = `cbz-upscale — Upscale CBZ comic book archives

Usage: cbz-upscale <input.cbz> [options]

Options:
  -o, --output <path>     Output file (default: <input>_upscaled.cbz)
  -e, --engine <name>     Engine to use (default: waifu2x)
  -s, --scale <2|4>       Scale factor (default: 2)
  -n, --noise <-1..3>     Denoise level (default: -1, none)
  --config <path>         Config file path
  --dry-run               Show what would be done
  -h, --help              Show this help`;

export interface CliArgs {
  input: string;
  output: string;
  engine: string;
  scale: number;
  noise: number;
  configPath?: string;
  dryRun: boolean;
}

export function parseCliArgs(args: string[]): CliArgs {
  const parsed = parseArgs(args, {
    string: ["output", "engine", "config"],
    boolean: ["help", "dry-run"],
    alias: { o: "output", e: "engine", s: "scale", n: "noise", h: "help" },
    default: { engine: "waifu2x", scale: 2, noise: -1 },
  });

  if (parsed.help) {
    console.log(HELP);
    Deno.exit(0);
  }

  const input = parsed._[0];
  if (!input || typeof input !== "string") {
    console.error("Error: input CBZ file is required\n");
    console.error(HELP);
    Deno.exit(1);
  }

  const scale = Number(parsed.scale);
  if (![2, 4].includes(scale)) {
    console.error("Error: --scale must be 2 or 4");
    Deno.exit(1);
  }

  const noise = Number(parsed.noise);
  if (![-1, 0, 1, 2, 3].includes(noise)) {
    console.error("Error: --noise must be -1, 0, 1, 2, or 3");
    Deno.exit(1);
  }

  const defaultOutput = join(
    dirname(input),
    basename(input, ".cbz") + "_upscaled.cbz",
  );

  return {
    input,
    output: parsed.output ?? defaultOutput,
    engine: parsed.engine ?? "waifu2x",
    scale,
    noise,
    configPath: parsed.config,
    dryRun: parsed["dry-run"] ?? false,
  };
}

async function main(): Promise<void> {
  const args = parseCliArgs(Deno.args);

  // Load config and register engines
  const config = await loadConfig(args.configPath);

  for (const [name, engineConfig] of Object.entries(config.engines)) {
    if (name === "waifu2x") {
      registerEngine(name, () => createWaifu2xEngine(engineConfig));
    }
  }

  // Get selected engine
  const engine = getEngine(args.engine);

  // Check engine availability
  const available = await engine.checkAvailable();
  if (!available) {
    console.error(
      `Error: Engine "${args.engine}" binary not found or not executable.\n` +
        `Check the binaryPath in your config file.`,
    );
    Deno.exit(1);
  }

  if (args.dryRun) {
    console.log("Dry run — would perform:");
    console.log(`  Input:  ${args.input}`);
    console.log(`  Output: ${args.output}`);
    console.log(`  Engine: ${args.engine}`);
    console.log(`  Scale:  ${args.scale}x`);
    console.log(`  Noise:  ${args.noise}`);
    console.log(`  Available engines: ${listEngines().join(", ")}`);
    return;
  }

  // Check output doesn't exist (repackCbz also checks, but fail early)
  try {
    await Deno.stat(args.output);
    console.error(`Error: Output file already exists: ${args.output}`);
    Deno.exit(1);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }

  console.log(`Upscaling ${args.input}...`);
  console.log(`  Engine: ${args.engine} | Scale: ${args.scale}x | Noise: ${args.noise}`);

  await withTempContext(async (ctx) => {
    // Extract
    console.log("Extracting CBZ...");
    const contents = await extractCbz(args.input, ctx.inputDir);
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
      await Deno.mkdir(dirname(dst), { recursive: true });
      await Deno.copyFile(src, dst);
      await tagFile(dst, meta);
    }

    // Repack
    console.log("Repacking CBZ...");
    await repackCbz(ctx.outputDir, args.output);
  });

  console.log(`Done! Output: ${args.output}`);
}

if (import.meta.main) {
  main();
}
