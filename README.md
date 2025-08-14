# Sora

A CLI that shoves your CBZ archives through AI upscaling engines and spits out files so sharp they could cut glass.

## Features

- **AI upscaling** — pluggable engine system (ships with waifu2x-ncnn-vulkan)
- **Parallel processing** — configurable concurrency for batch upscaling
- **Metadata preservation** — non-image files are copied and tagged with upscale info
- **Scale & denoise** — 2x/4x upscaling with adjustable noise reduction (-1 to 3)
- **Dry run mode** — preview what would happen before committing

## Install

Requires [Deno](https://deno.com).

```sh
# Run directly
deno task start

# Or compile to a binary
deno task compile
```

## Setup

Create a config file at `~/.config/sora/config.json`:

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

## Usage

```sh
sora <input.cbz> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <path>` | Output file path | `<input>_upscaled.cbz` |
| `-e, --engine <name>` | Upscaling engine | `waifu2x` |
| `-s, --scale <2\|4>` | Scale factor | `2` |
| `-n, --noise <-1..3>` | Denoise level (-1 = off) | `-1` |
| `-j, --concurrency <N>` | Parallel processes | `1` |
| `--config <path>` | Custom config file | `~/.config/sora/config.json` |
| `--dry-run` | Preview without upscaling | — |

### Examples

```sh
# Basic 2x upscale
sora manga-vol1.cbz

# 4x upscale with denoising, 4 parallel processes
sora manga-vol1.cbz -s 4 -n 2 -j 4

# Custom output path
sora manga-vol1.cbz -o manga-vol1-hd.cbz

# See what would happen
sora manga-vol1.cbz --dry-run
```

## License

MIT
