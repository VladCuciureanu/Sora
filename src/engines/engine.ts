export interface UpscaleOpts {
  scale: number;
  noise: number;
}

export interface UpscaleEngine {
  name: string;
  upscale(inputDir: string, outputDir: string, opts: UpscaleOpts): Promise<void>;
  checkAvailable(): Promise<boolean>;
}
