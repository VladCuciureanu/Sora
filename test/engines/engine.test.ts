import { test } from "node:test";
import assert from "node:assert/strict";
import { registerEngine, getEngine, listEngines } from "../../src/engines/engine.ts";
import type { UpscaleEngine } from "../../src/engines/engine.ts";

function makeDummyEngine(name: string): UpscaleEngine {
  return {
    name,
    async upscale() {},
    async checkAvailable() { return true; },
  };
}

test("registerEngine and getEngine - round trip", () => {
  registerEngine("test-engine", () => makeDummyEngine("test-engine"));
  const engine = getEngine("test-engine");
  assert.equal(engine.name, "test-engine");
});

test("getEngine - throws on unknown engine", () => {
  assert.throws(
    () => getEngine("nonexistent"),
    { name: "Error", message: /Unknown engine/ },
  );
});

test("listEngines - returns registered names", () => {
  registerEngine("engine-a", () => makeDummyEngine("engine-a"));
  registerEngine("engine-b", () => makeDummyEngine("engine-b"));
  const names = listEngines();
  assert.equal(names.includes("engine-a"), true);
  assert.equal(names.includes("engine-b"), true);
});
