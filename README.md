# AI Sprite Animator

**Turn a green-screen animation video into a clean, transparent sprite sheet — 100% in your browser. No upload, no install, free.**

Built for AI game devs: generate a character animation as a green-screen video (Seedance, Kling, Runway…), drop it here, and get a game-ready transparent PNG sprite sheet.

<!-- TODO: add a before/after demo GIF here -->
<!-- ![demo](docs/demo.gif) -->

---

## Why video → slice, instead of frame-by-frame AI?

AI image models drift when you ask them to generate an animation **frame by frame** — the character jitters, details wander, 8 frames is barely enough and past 8 it falls apart.

**The trick:** don't generate frames. Generate one **continuous green-screen video**, then slice it.
Because a video is one continuous thing, every sliced frame is **naturally consistent** — you sidestep the "AI per-frame inconsistency" problem entirely, and you can pull 16, 24, 32 crisp frames instead of 8.

This tool does the rest: chroma-key the green out → trim each frame → pack into a tight grid → export a transparent sprite sheet.

---

## Features

- **Green-screen removal** — YUV chroma key with auto color detection + adjustable similarity / edge softness / spill suppression.
- **Full resolution, no blur** — frames are extracted at the video's native resolution (slicing a video, not one big image), so more frames never means blurrier.
- **Auto-trim** — every frame is cropped to its opaque bounding box (shared across frames so the sprite stays registered), cutting wasted transparent pixels.
- **Segment select** — pick a start/end range of the clip; a still thumbnail shows the frame at each handle so you're not cutting blind.
- **Ping-pong output** — bake a seamless forward+back loop (N → 2N-2 frames) so idle animations loop with no seam, using a plain sequential playback in any engine.
- **Frame count & grid** — choose 8 / 12 / 16 / 24 (or custom), and columns or auto square-ish grid.
- **Real-time animation preview** — plays back at the source's real speed; changing frame count changes smoothness, not speed.
- **Transparent PNG + JSON** — download a transparent sprite sheet plus a JSON descriptor with every frame's grid coordinates.
- **Client-side & private** — everything runs in your browser via the native `<video>` decoder + canvas. Your footage never leaves your machine.

---

## Quick start

No build step, no `npm install` — it's plain ES modules served statically.

```bash
node serve.js          # → http://localhost:5173
```

Then open **http://localhost:5173** and:

1. Drag in a green-screen animation video (mp4 / H.264 or webm).
2. Pick a frame count (8 / 12 / 16 / 24).
3. (Optional) trim to a segment, tweak the chroma-key sliders, tick **ping-pong** for seamless idles.
4. Click **生成 Sprite Sheet / Generate**.
5. Download the transparent PNG (and the JSON grid metadata).

You can deploy the same files to any static host (GitHub Pages, itch.io, Netlify) — there are no special headers to configure.

### Try it with the sample

A tiny synthetic green-screen clip is included at `test-assets/greenscreen.mp4` (a red ball orbiting on chroma green) so you can see the whole pipeline immediately.

---

## How it works

```
green-screen video
  → extract N frames (native <video> seek + canvas, full resolution)
  → chroma key (YUV distance + spill suppression → transparent)
  → trim each frame to the shared opaque bounding box
  → pack into a uniform grid (optionally ping-pong)
  → export transparent PNG + JSON coordinates
```

The tool uses the browser's **native video decoding** rather than `ffmpeg.wasm`, so there's no `SharedArrayBuffer` / COOP-COEP requirement and it deploys to any static host as-is.

---

## Project structure

```
src/core/          framework-agnostic pure functions (reusable in a future CLI)
  chroma.js        green-screen removal (YUV chroma key + spill suppression)
  trim.js          opaque bounding box + shared-crop registration
  pack.js          frame count → grid layout
  extract.js       video → frames (browser, native decode)
  sheet.js         compose sprite sheet + PNG export
index.html         UI
src/app.js         UI glue
serve.js           zero-dependency static dev server
```

The `src/core/` modules operate on raw RGBA buffers with no DOM dependency, so a CLI build (native `ffmpeg` + `sharp`) can reuse them verbatim.

---

## Roadmap

- CLI (`node stitch.js --input video.mp4 --frames 16 --trim --output sheet.png`) reusing `src/core/`.
- PNG compression pass (pngquant / oxipng) for even smaller sheets.
- Agent-operable repo (`AGENTS.md`): point your Claude Code / Cursor at this repo + your video, get a sprite sheet back.

## License

MIT © Kuanming (陳冠名)
