import { readdir } from "node:fs/promises";
import { basename, join, extname, relative, resolve } from "node:path";
import { run } from "./exec.ts";

// Formats waifu2x-ncnn-vulkan can read. Other images (gif, bmp, tiff, ...)
// are treated as ordinary files and copied through unchanged.
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export interface CbzContents {
  imageFiles: string[];
  otherFiles: string[];
}

export function isImageFile(path: string): boolean {
  // macOS AppleDouble files (`._page.jpg`, usually under `__MACOSX/`) are
  // metadata, not images; waifu2x can't read them.
  if (basename(path).startsWith("._")) return false;
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

export async function extractCbz(cbzPath: string, outputDir: string): Promise<CbzContents> {
  // Extract via the system `unzip` command
  const result = await run("unzip", ["-o", cbzPath, "-d", outputDir]);
  if (!result.success) {
    throw new Error(`Failed to extract CBZ: ${result.stderr}`);
  }

  return categorizeFiles(outputDir);
}

export async function categorizeFiles(dir: string): Promise<CbzContents> {
  const imageFiles: string[] = [];
  const otherFiles: string[] = [];

  for await (const entry of walkFiles(dir)) {
    const rel = relative(dir, entry);
    if (isImageFile(rel)) {
      imageFiles.push(rel);
    } else {
      otherFiles.push(rel);
    }
  }

  imageFiles.sort();
  otherFiles.sort();
  return { imageFiles, otherFiles };
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

/** Zip `sourceDir` into `outputPath`. The caller ensures `outputPath` does not exist yet. */
export async function repackCbz(sourceDir: string, outputPath: string): Promise<void> {
  // zip runs inside sourceDir, so a relative outputPath must be resolved first
  // or the archive lands in the temp dir and is deleted with it.
  const result = await run("zip", ["-r", resolve(outputPath), "."], { cwd: sourceDir });
  if (!result.success) {
    throw new Error(`Failed to create CBZ: ${result.stderr}`);
  }
}
