import { readdir } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { run as defaultRun, type Runner } from "./exec.ts";

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

export async function extractCbz(
  cbzPath: string,
  outputDir: string,
  { run = defaultRun }: { run?: Runner } = {},
): Promise<CbzContents> {
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

  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const rel = relative(dir, join(entry.parentPath, entry.name));
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

/** Zip `sourceDir` into `outputPath`. The caller ensures `outputPath` does not exist yet. */
export async function repackCbz(
  sourceDir: string,
  outputPath: string,
  { run = defaultRun }: { run?: Runner } = {},
): Promise<void> {
  // zip runs inside sourceDir, so a relative outputPath must be resolved first
  // or the archive lands in the temp dir and is deleted with it.
  const result = await run("zip", ["-r", resolve(outputPath), "."], { cwd: sourceDir });
  if (!result.success) {
    throw new Error(`Failed to create CBZ: ${result.stderr}`);
  }
}
