export interface UpscaleOpts {
  scale: number;
  noise: number;
}

export interface UpscaleEngine {
  name: string;
  upscale(inputDir: string, outputDir: string, opts: UpscaleOpts): Promise<void>;
  checkAvailable(): Promise<boolean>;
}

const registry = new Map<string, () => UpscaleEngine>();

export function registerEngine(name: string, factory: () => UpscaleEngine): void {
  registry.set(name, factory);
}

export function getEngine(name: string): UpscaleEngine {
  const factory = registry.get(name);
  if (!factory) {
    const available = [...registry.keys()].join(", ") || "none";
    throw new Error(`Unknown engine "${name}". Available: ${available}`);
  }
  return factory();
}

export function listEngines(): string[] {
  return [...registry.keys()];
}
