import { test } from "node:test";
import assert from "node:assert/strict";
import { splitIntoBatches, buildWaifu2xArgs } from "../../src/engines/waifu2x.ts";

test("splitIntoBatches - splits evenly", () => {
  const items = [1, 2, 3, 4, 5, 6];
  const batches = splitIntoBatches(items, 2);
  assert.deepEqual(batches, [[1, 2], [3, 4], [5, 6]]);
});

test("splitIntoBatches - handles remainder", () => {
  const items = [1, 2, 3, 4, 5];
  const batches = splitIntoBatches(items, 2);
  assert.deepEqual(batches, [[1, 2], [3, 4], [5]]);
});

test("splitIntoBatches - single batch when under size", () => {
  const items = [1, 2, 3];
  const batches = splitIntoBatches(items, 10);
  assert.deepEqual(batches, [[1, 2, 3]]);
});

test("splitIntoBatches - empty input", () => {
  const batches = splitIntoBatches([], 5);
  assert.deepEqual(batches, []);
});

test("buildWaifu2xArgs - basic scale only", () => {
  const args = buildWaifu2xArgs("/in/img.jpg", "/out/img.jpg", { scale: 2, noise: -1 });
  assert.deepEqual(args, ["-i", "/in/img.jpg", "-o", "/out/img.jpg", "-s", "2"]);
});

test("buildWaifu2xArgs - with noise reduction", () => {
  const args = buildWaifu2xArgs("/in/img.jpg", "/out/img.jpg", { scale: 4, noise: 2 });
  assert.deepEqual(args, ["-i", "/in/img.jpg", "-o", "/out/img.jpg", "-s", "4", "-n", "2"]);
});

test("buildWaifu2xArgs - noise level 0 is included", () => {
  const args = buildWaifu2xArgs("/in/img.jpg", "/out/img.jpg", { scale: 2, noise: 0 });
  assert.deepEqual(args, ["-i", "/in/img.jpg", "-o", "/out/img.jpg", "-s", "2", "-n", "0"]);
});
