import { join, dirname, basename, extname } from "@std/path";

export interface UpscaleMetadata {
  engine: string;
  scale: number;
  noise: number;
  timestamp: string;
}

const XML_EXTENSIONS = new Set([".xml"]);

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

export async function tagFile(filePath: string, meta: UpscaleMetadata): Promise<void> {
  const ext = extname(filePath).toLowerCase();

  if (XML_EXTENSIONS.has(ext)) {
    await tagXmlFile(filePath, meta);
  } else {
    await writeSidecarFile(filePath, meta);
  }
}

async function tagXmlFile(filePath: string, meta: UpscaleMetadata): Promise<void> {
  let content = await Deno.readTextFile(filePath);

  const metaXml = [
    `  <UpscaleInfo>`,
    `    <Engine>${escapeXml(meta.engine)}</Engine>`,
    `    <Scale>${meta.scale}</Scale>`,
    `    <Noise>${meta.noise}</Noise>`,
    `    <Timestamp>${escapeXml(meta.timestamp)}</Timestamp>`,
    `  </UpscaleInfo>`,
  ].join("\n");

  // Try to insert before the closing root tag
  const closingTagMatch = content.match(/<\/(\w+)>\s*$/);
  if (closingTagMatch) {
    const idx = content.lastIndexOf(closingTagMatch[0]);
    content = content.slice(0, idx) + metaXml + "\n" + content.slice(idx);
  } else {
    // Append if no closing tag found
    content += "\n" + metaXml;
  }

  await Deno.writeTextFile(filePath, content);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sidecarPath(filePath: string): string {
  const dir = dirname(filePath);
  const name = basename(filePath);
  return join(dir, `${name}.upscale-meta.json`);
}

async function writeSidecarFile(filePath: string, meta: UpscaleMetadata): Promise<void> {
  const path = sidecarPath(filePath);
  await Deno.writeTextFile(path, JSON.stringify(meta, null, 2) + "\n");
}
