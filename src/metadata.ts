import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Name of the metadata file written at the root of every upscaled archive. */
export const METADATA_FILENAME = "sora.upscale.json";

export interface UpscaleMetadata {
  engine: string;
  scale: number;
  noise: number;
  timestamp: string;
}

export function createUpscaleMetadata(
  engine: string,
  scale: number,
  noise: number,
): UpscaleMetadata {
  return {
    engine,
    scale,
    noise,
    timestamp: new Date().toISOString(),
  };
}

/** Write `meta` as `sora.upscale.json` in `dir` (the archive root), replacing any existing one. */
export async function writeUpscaleMetadata(dir: string, meta: UpscaleMetadata): Promise<void> {
  await writeFile(join(dir, METADATA_FILENAME), `${JSON.stringify(meta, null, 2)}\n`);
}
