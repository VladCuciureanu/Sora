import { assert, assertEquals, assertRejects } from "@std/assert";
import { createTempContext, withTempContext } from "../src/temp.ts";

Deno.test("createTempContext - creates two temp dirs", async () => {
  const ctx = await createTempContext();
  const inStat = await Deno.stat(ctx.inputDir);
  const outStat = await Deno.stat(ctx.outputDir);
  assert(inStat.isDirectory);
  assert(outStat.isDirectory);
  assert(ctx.inputDir !== ctx.outputDir);
  await ctx.cleanup();
});

Deno.test("createTempContext - cleanup removes dirs", async () => {
  const ctx = await createTempContext();
  // Write a file inside to ensure recursive removal works
  await Deno.writeTextFile(`${ctx.inputDir}/test.txt`, "hello");
  await ctx.cleanup();

  await assertRejects(() => Deno.stat(ctx.inputDir), Deno.errors.NotFound);
  await assertRejects(() => Deno.stat(ctx.outputDir), Deno.errors.NotFound);
});

Deno.test("createTempContext - cleanup is safe to call twice", async () => {
  const ctx = await createTempContext();
  await ctx.cleanup();
  await ctx.cleanup(); // should not throw
});

Deno.test("withTempContext - cleans up after success", async () => {
  let savedInputDir = "";
  const result = await withTempContext(async (ctx) => {
    savedInputDir = ctx.inputDir;
    return 42;
  });

  assertEquals(result, 42);
  await assertRejects(() => Deno.stat(savedInputDir), Deno.errors.NotFound);
});

Deno.test("withTempContext - cleans up after error", async () => {
  let savedInputDir = "";
  await assertRejects(async () => {
    await withTempContext(async (ctx) => {
      savedInputDir = ctx.inputDir;
      throw new Error("boom");
    });
  }, Error, "boom");

  await assertRejects(() => Deno.stat(savedInputDir), Deno.errors.NotFound);
});
