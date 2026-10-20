import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { RunResult } from "../src/exec.ts";
import { buildWaifu2xArgs, runPool, upscaleImages } from "../src/waifu2x.ts";

const makeTempDir = () => mkdtemp(join(tmpdir(), "sora-test-"));
const inImg = join("in", "img.jpg");
const outImg = join("out", "img.jpg");

/** Fake waifu2x runner: copies the `-i` file to the `-o` path. */
async function copyRunner(_command: string, args: string[]): Promise<RunResult> {
  const input = args[args.indexOf("-i") + 1];
  const output = args[args.indexOf("-o") + 1];
  await copyFile(input, output);
  return { success: true, stderr: "" };
}

test("buildWaifu2xArgs - basic scale only", () => {
  const args = buildWaifu2xArgs(inImg, outImg, { scale: 2, noise: -1 });
  assert.deepEqual(args, ["-i", inImg, "-o", outImg, "-s", "2"]);
});

test("buildWaifu2xArgs - with noise reduction", () => {
  const args = buildWaifu2xArgs(inImg, outImg, { scale: 4, noise: 2 });
  assert.deepEqual(args, ["-i", inImg, "-o", outImg, "-s", "4", "-n", "2"]);
});

test("buildWaifu2xArgs - noise level 0 is included", () => {
  const args = buildWaifu2xArgs(inImg, outImg, { scale: 2, noise: 0 });
  assert.deepEqual(args, ["-i", inImg, "-o", outImg, "-s", "2", "-n", "0"]);
});

test("waifu2x upscale - processes nested images and preserves relative paths", async () => {
  const workDir = await makeTempDir();
  const inputDir = join(workDir, "in");
  const outputDir = join(workDir, "out");
  await mkdir(join(inputDir, "chapter1"), { recursive: true });
  await mkdir(outputDir);
  await writeFile(join(inputDir, "cover.jpg"), "cover");
  await writeFile(join(inputDir, "chapter1", "page01.png"), "nested");

  await upscaleImages(inputDir, outputDir, ["cover.jpg", join("chapter1", "page01.png")], {
    binaryPath: "waifu2x",
    scale: 2,
    noise: -1,
    run: copyRunner,
  });

  assert.equal(await readFile(join(outputDir, "cover.jpg"), "utf8"), "cover");
  assert.equal(await readFile(join(outputDir, "chapter1", "page01.png"), "utf8"), "nested");

  await rm(workDir, { recursive: true });
});

/** Collect unhandledRejection events emitted while `fn` runs (plus a grace period). */
async function captureUnhandledRejections(fn: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const listener = (reason: unknown) => {
    seen.push(reason);
  };
  process.on("unhandledRejection", listener);
  try {
    await fn();
    // Give late-rejecting tasks a chance to surface as unhandled.
    await delay(100);
  } finally {
    process.off("unhandledRejection", listener);
  }
  return seen;
}

test("runPool - failing task yields a single rejection after in-flight tasks settle", async () => {
  const settled: number[] = [];
  const started: number[] = [];
  let result: PromiseSettledResult<void> | undefined;

  const unhandled = await captureUnhandledRejections(async () => {
    [result] = await Promise.allSettled([
      runPool([1, 2, 3, 4, 5, 6], 3, async (n) => {
        started.push(n);
        if (n === 1) throw new Error("task 1 failed");
        await delay(30);
        settled.push(n);
        throw new Error(`task ${n} failed`);
      }),
    ]);
  });

  assert.equal(result?.status, "rejected");
  assert.equal((result as PromiseRejectedResult).reason.message, "task 1 failed");
  // No new tasks start after the first failure; in-flight ones are awaited.
  assert.deepEqual(started, [1, 2, 3]);
  assert.deepEqual(settled.sort(), [2, 3]);
  assert.deepEqual(unhandled, []);
});

test("runPool - resolves when all tasks succeed and respects concurrency", async () => {
  let active = 0;
  let maxActive = 0;
  const done: number[] = [];
  await runPool([1, 2, 3, 4, 5], 2, async (n) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await delay(5);
    active--;
    done.push(n);
  });
  assert.equal(maxActive, 2);
  assert.deepEqual(done.sort(), [1, 2, 3, 4, 5]);
});

test("waifu2x upscale - concurrent failure rejects once with no unhandled rejections", async () => {
  const workDir = await makeTempDir();
  const inputDir = join(workDir, "in");
  const outputDir = join(workDir, "out");
  await mkdir(inputDir, { recursive: true });
  await mkdir(outputDir);
  for (const name of ["a.jpg", "b.jpg", "c.jpg", "d.jpg"]) {
    await writeFile(join(inputDir, name), name);
  }

  const inFlight = new Set<string>();
  const runner = async (_command: string, args: string[]): Promise<RunResult> => {
    const name = basename(args[args.indexOf("-i") + 1]);
    if (name === "a.jpg") {
      // Fail once the other workers have their tasks in flight.
      await delay(10);
      return { success: false, stderr: "boom" };
    }
    inFlight.add(name);
    await delay(30);
    inFlight.delete(name);
    throw new Error(`spawn failed for ${name}`);
  };

  let result: PromiseSettledResult<void> | undefined;
  const unhandled = await captureUnhandledRejections(async () => {
    [result] = await Promise.allSettled([
      upscaleImages(inputDir, outputDir, ["a.jpg", "b.jpg", "c.jpg", "d.jpg"], {
        binaryPath: "waifu2x",
        scale: 2,
        noise: -1,
        concurrency: 3,
        run: runner,
      }).finally(() => {
        // Every started task must have settled before upscale settles.
        assert.equal(inFlight.size, 0);
      }),
    ]);
  });

  assert.equal(result?.status, "rejected");
  assert.match((result as PromiseRejectedResult).reason.message, /waifu2x failed on a\.jpg: boom/);
  assert.deepEqual(unhandled, []);

  await rm(workDir, { recursive: true });
});
