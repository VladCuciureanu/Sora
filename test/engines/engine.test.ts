import { assertEquals, assertThrows } from "@std/assert";
import { registerEngine, getEngine, listEngines } from "../../src/engines/engine.ts";
import type { UpscaleEngine } from "../../src/engines/engine.ts";

function makeDummyEngine(name: string): UpscaleEngine {
  return {
    name,
    async upscale() {},
    async checkAvailable() { return true; },
  };
}

Deno.test("registerEngine and getEngine - round trip", () => {
  registerEngine("test-engine", () => makeDummyEngine("test-engine"));
  const engine = getEngine("test-engine");
  assertEquals(engine.name, "test-engine");
});

Deno.test("getEngine - throws on unknown engine", () => {
  assertThrows(
    () => getEngine("nonexistent"),
    Error,
    "Unknown engine",
  );
});

Deno.test("listEngines - returns registered names", () => {
  registerEngine("engine-a", () => makeDummyEngine("engine-a"));
  registerEngine("engine-b", () => makeDummyEngine("engine-b"));
  const names = listEngines();
  assertEquals(names.includes("engine-a"), true);
  assertEquals(names.includes("engine-b"), true);
});
