import { assertEquals } from "@std/assert";
import { splitIntoBatches, buildWaifu2xArgs } from "../../src/engines/waifu2x.ts";

Deno.test("splitIntoBatches - splits evenly", () => {
  const items = [1, 2, 3, 4, 5, 6];
  const batches = splitIntoBatches(items, 2);
  assertEquals(batches, [[1, 2], [3, 4], [5, 6]]);
});

Deno.test("splitIntoBatches - handles remainder", () => {
  const items = [1, 2, 3, 4, 5];
  const batches = splitIntoBatches(items, 2);
  assertEquals(batches, [[1, 2], [3, 4], [5]]);
});

Deno.test("splitIntoBatches - single batch when under size", () => {
  const items = [1, 2, 3];
  const batches = splitIntoBatches(items, 10);
  assertEquals(batches, [[1, 2, 3]]);
});

Deno.test("splitIntoBatches - empty input", () => {
  const batches = splitIntoBatches([], 5);
  assertEquals(batches, []);
});

Deno.test("buildWaifu2xArgs - basic scale only", () => {
  const args = buildWaifu2xArgs("/in/img.jpg", "/out/img.jpg", { scale: 2, noise: -1 });
  assertEquals(args, ["-i", "/in/img.jpg", "-o", "/out/img.jpg", "-s", "2"]);
});

Deno.test("buildWaifu2xArgs - with noise reduction", () => {
  const args = buildWaifu2xArgs("/in/img.jpg", "/out/img.jpg", { scale: 4, noise: 2 });
  assertEquals(args, ["-i", "/in/img.jpg", "-o", "/out/img.jpg", "-s", "4", "-n", "2"]);
});

Deno.test("buildWaifu2xArgs - noise level 0 is included", () => {
  const args = buildWaifu2xArgs("/in/img.jpg", "/out/img.jpg", { scale: 2, noise: 0 });
  assertEquals(args, ["-i", "/in/img.jpg", "-o", "/out/img.jpg", "-s", "2", "-n", "0"]);
});
