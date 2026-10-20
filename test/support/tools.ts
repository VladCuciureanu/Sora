import { spawnSync } from "node:child_process";

function hasCommand(command: string): boolean {
  return spawnSync(command, ["-v"], { stdio: "ignore" }).error === undefined;
}

/** `skip` option for tests that shell out to the system `zip`/`unzip`. */
export const skipWithoutZip: string | false =
  hasCommand("zip") && hasCommand("unzip") ? false : "zip/unzip not installed";
