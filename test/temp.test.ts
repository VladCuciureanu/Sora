import { test } from "node:test";
import assert from "node:assert/strict";
import { stat, writeFile } from "node:fs/promises";
import { createTempContext, withTempContext } from "../src/temp.ts";

test("createTempContext - creates two temp dirs", async () => {
  const ctx = await createTempContext();
  const inStat = await stat(ctx.inputDir);
  const outStat = await stat(ctx.outputDir);
  assert.ok(inStat.isDirectory());
  assert.ok(outStat.isDirectory());
  assert.ok(ctx.inputDir !== ctx.outputDir);
  await ctx.cleanup();
});

test("createTempContext - cleanup removes dirs", async () => {
  const ctx = await createTempContext();
  // Write a file inside to ensure recursive removal works
  await writeFile(`${ctx.inputDir}/test.txt`, "hello");
  await ctx.cleanup();

  await assert.rejects(() => stat(ctx.inputDir), { code: "ENOENT" });
  await assert.rejects(() => stat(ctx.outputDir), { code: "ENOENT" });
});

test("createTempContext - cleanup is safe to call twice", async () => {
  const ctx = await createTempContext();
  await ctx.cleanup();
  await ctx.cleanup(); // should not throw
});

test("withTempContext - cleans up after success", async () => {
  let savedInputDir = "";
  const result = await withTempContext(async (ctx) => {
    savedInputDir = ctx.inputDir;
    return 42;
  });

  assert.equal(result, 42);
  await assert.rejects(() => stat(savedInputDir), { code: "ENOENT" });
});

test("withTempContext - cleans up after error", async () => {
  let savedInputDir = "";
  await assert.rejects(async () => {
    await withTempContext(async (ctx) => {
      savedInputDir = ctx.inputDir;
      throw new Error("boom");
    });
  }, { name: "Error", message: /boom/ });

  await assert.rejects(() => stat(savedInputDir), { code: "ENOENT" });
});
