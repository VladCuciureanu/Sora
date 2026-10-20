# Sora

Sora upscales the pages of a CBZ comic archive with [waifu2x-ncnn-vulkan](https://github.com/nihui/waifu2x-ncnn-vulkan) and writes a new CBZ next to the original.

```sh
sora manga-vol1.cbz -s 4 -n 2
```

```text
Upscaling manga-vol1.cbz...
  Engine: waifu2x | Scale: 4x | Noise: 2
Extracting CBZ...
  Found 212 images, 1 other files
Upscaling images...
  [100%] 212/212 — page212.jpg
Repacking CBZ...
Done! Output: manga-vol1_upscaled.cbz
```

JPEG, PNG and WebP pages are upscaled. Everything else in the archive (GIF/BMP/TIFF images, `ComicInfo.xml`, other files) is copied through unchanged, and macOS `._*` files are never treated as images. Sora adds a `sora.upscale.json` at the archive root recording the engine, scale, noise level and timestamp.

## Requirements

- Node.js 26 or newer
- `zip` and `unzip` on your `PATH`
- A [waifu2x-ncnn-vulkan](https://github.com/nihui/waifu2x-ncnn-vulkan/releases) binary, with the release's `models-cunet` directory left next to it (Sora uses the default model)
- A Vulkan-capable GPU (required by waifu2x-ncnn-vulkan)

## Install

```sh
npm install   # also builds dist/
npm link      # puts `sora` on your PATH
```

Or run from source without linking: `npm start -- <input.cbz> [options]`.

## Configuration

Sora reads `$HOME/.config/sora/config.json` (`%USERPROFILE%\.config\sora\config.json` on Windows if `HOME` is unset), or the file given with `--config`. It must exist.

```json
{
  "engines": {
    "waifu2x": {
      "binaryPath": "/path/to/waifu2x-ncnn-vulkan",
      "concurrency": 2
    }
  }
}
```

| Key | Required | Description |
|-----|----------|-------------|
| `engines.waifu2x.binaryPath` | yes | Path to the waifu2x-ncnn-vulkan binary |
| `engines.waifu2x.concurrency` | no | Number of waifu2x processes to run at once (default `1`); `-j` overrides it |

## Usage

```sh
sora <input.cbz> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <path>` | Output file; must not already exist | `<input>_upscaled.cbz` in the input's directory |
| `-e, --engine <name>` | Engine (only `waifu2x` exists) | `waifu2x` |
| `-s, --scale <2\|4>` | Scale factor | `2` |
| `-n, --noise <-1..3>` | Denoise level; `-1` disables denoising | `-1` |
| `-j, --concurrency <N>` | Parallel waifu2x processes | config value, else `1` |
| `--config <path>` | Config file | `~/.config/sora/config.json` |
| `--dry-run` | Check the config and binary, print the plan, and exit | |
| `-h, --help` | Print help | |

Unknown options and extra arguments are errors. Errors go to stderr, prefixed `sora:`, and exit with status 1.

```sh
sora manga-vol1.cbz -o manga-vol1-hd.cbz -j 4
sora manga-vol1.cbz --dry-run
```

## Development

```sh
npm run dev        # run src/main.ts with --watch
npm test           # node --test; zip/unzip tests skip if the tools are missing
npm run typecheck  # tsc
npm run lint       # biome lint
npm run format     # biome check --write (format, sort imports, safe fixes)
npm run check      # biome check, typecheck and tests (what CI runs)
npm run build      # compile to dist/
```

Tests live in `test/` as `*.test.ts`.

## License

MIT
