import { join, extname, relative } from "@std/path";

const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif", ".gif",
]);

export interface CbzContents {
  imageFiles: string[];
  otherFiles: string[];
}

export function isImageFile(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

export async function extractCbz(cbzPath: string, outputDir: string): Promise<CbzContents> {
  // Use Deno's built-in zip handling via `unzip` command
  const cmd = new Deno.Command("unzip", {
    args: ["-o", cbzPath, "-d", outputDir],
    stdout: "null",
    stderr: "piped",
  });
  const result = await cmd.output();
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(`Failed to extract CBZ: ${stderr}`);
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
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      yield* walkFiles(path);
    } else if (entry.isFile) {
      yield path;
    }
  }
}

export async function repackCbz(sourceDir: string, outputPath: string): Promise<void> {
  try {
    await Deno.stat(outputPath);
    throw new Error(`Output file already exists: ${outputPath}`);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      throw e;
    }
  }

  const cmd = new Deno.Command("zip", {
    args: ["-r", outputPath, "."],
    cwd: sourceDir,
    stdout: "null",
    stderr: "piped",
  });
  const result = await cmd.output();
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(`Failed to create CBZ: ${stderr}`);
  }
}
