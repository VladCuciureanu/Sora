import { spawn } from "node:child_process";

export interface RunResult {
  success: boolean;
  stderr: string;
}

/**
 * Run a command to completion, discarding stdout and capturing stderr.
 * Rejects only if the process cannot be spawned (e.g. ENOENT);
 * a non-zero exit resolves with `success: false`.
 */
export function run(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ success: code === 0, stderr: Buffer.concat(chunks).toString("utf8") });
    });
  });
}
