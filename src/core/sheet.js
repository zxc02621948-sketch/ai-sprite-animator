// sheet.js — orchestrate frames -> transparent sprite sheet (browser build).
//
// Pulls together the pure core (chroma / trim / pack) and uses a canvas as the
// compositor + scaler. Returns a ready-to-download canvas plus an engine-
// friendly JSON descriptor.

import { chromaKey, detectKeyColor } from './chroma.js';
import { opaqueBounds, unionBounds, padBounds } from './trim.js';
import { layout } from './pack.js';

/** Wrap an ImageData in its own canvas so we can drawImage/scale from it. */
function imageDataToCanvas(imageData) {
  const c = document.createElement('canvas');
  c.width = imageData.width;
  c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  return c;
}

/**
 * Build a transparent sprite sheet from raw frames.
 *
 * @param {ImageData[]} frames full-resolution RGBA frames (from extract.js)
 * @param {object} [opts]
 * @param {object} [opts.chroma] passed to chromaKey() (similarity/smoothness/spill/keyColor)
 * @param {boolean} [opts.removeBackground=true] run chroma key; false keeps source alpha
 * @param {number} [opts.alphaThreshold=8] alpha at/below which a pixel counts as empty for trim
 * @param {number} [opts.pad=1] transparent padding kept around the trimmed sprite (px)
 * @param {number} [opts.cellSize=0] max px on the cell's long edge (0 = keep trimmed size, no scale)
 * @param {number} [opts.columns=0] force grid columns (0 = auto ~square)
 * @param {number} [opts.gap=0] transparent gap between cells (px)
 * @param {boolean} [opts.pingpong=false] bake a ping-pong (0..N-1..1) loop into
 *        the sheet — 2N-2 cells — so an idle plays forward+back with no seam
 * @returns {{canvas:HTMLCanvasElement, meta:object}}
 */
export function buildSpriteSheet(frames, opts = {}) {
  if (!frames.length) throw new Error('沒有影格可以合成');

  const removeBg = opts.removeBackground !== false;
  const alphaThreshold = opts.alphaThreshold ?? 8;
  const pad = opts.pad ?? 1;
  const cellSize = opts.cellSize ?? 0;
  const gap = opts.gap ?? 0;
  const fullW = frames[0].width;
  const fullH = frames[0].height;

  // 1. Chroma key every frame (in place). Detect the key once from the first
  //    frame so every frame keys against the same colour (stable edges).
  let keyColor = opts.chroma?.keyColor;
  if (removeBg && !keyColor) {
    keyColor = detectKeyColor(frames[0].data, fullW, fullH);
  }
  if (removeBg) {
    for (const f of frames) {
      chromaKey(f.data, fullW, fullH, { ...opts.chroma, keyColor });
    }
  }

  // 2. Per-frame opaque bounds -> union, so all cells share one crop box and
  //    the sprite stays registered (no jitter) while empty margin is dropped.
  const boxes = frames.map((f) => opaqueBounds(f.data, fullW, fullH, alphaThreshold));
  let crop = unionBounds(boxes);
  if (!crop) crop = { x: 0, y: 0, w: fullW, h: fullH }; // fully empty -> keep full
  crop = padBounds(crop, pad, fullW, fullH);

  // 3. Decide per-cell pixel size. Never upscale (that would blur); cellSize
  //    only ever shrinks, giving the user the size<->smoothness trade-off.
  let scale = 1;
  if (cellSize > 0) {
    scale = Math.min(1, cellSize / Math.max(crop.w, crop.h));
  }
  const cellW = Math.max(1, Math.round(crop.w * scale));
  const cellH = Math.max(1, Math.round(crop.h * scale));

  // 4. Build the playback sequence. Ping-pong appends the interior frames in
  //    reverse (N-2..1), so a plain forward loop over the sheet reads
  //    0,1,…,N-1,N-2,…,1 → back to 0 with no seam. Frames are keyed only once
  //    (above); repeated cells just redraw the same source, so no double-key.
  const N = frames.length;
  const sequence = frames.map((_, i) => i);
  const pingpong = !!(opts.pingpong && N > 2);
  if (pingpong) {
    for (let i = N - 2; i >= 1; i--) sequence.push(i);
  }

  const grid = layout(sequence.length, cellW, cellH, { columns: opts.columns || undefined, gap });
  const sheet = document.createElement('canvas');
  sheet.width = grid.sheetW;
  sheet.height = grid.sheetH;
  const ctx = sheet.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const srcCanvases = frames.map(imageDataToCanvas);
  const frameMeta = [];
  sequence.forEach((fi, n) => {
    const cell = grid.cells[n];
    ctx.drawImage(srcCanvases[fi], crop.x, crop.y, crop.w, crop.h, cell.x, cell.y, cellW, cellH);
    frameMeta.push({ index: n, sourceFrame: fi, x: cell.x, y: cell.y, w: cellW, h: cellH, col: cell.col, row: cell.row });
  });

  const meta = {
    frameCount: sequence.length,
    sampledFrames: N,
    pingpong,
    columns: grid.columns,
    rows: grid.rows,
    cellWidth: cellW,
    cellHeight: cellH,
    gap,
    sheetWidth: grid.sheetW,
    sheetHeight: grid.sheetH,
    sourceResolution: { width: fullW, height: fullH },
    crop,
    keyColor: keyColor
      ? { r: Math.round(keyColor.r), g: Math.round(keyColor.g), b: Math.round(keyColor.b) }
      : null,
    frames: frameMeta,
  };

  return { canvas: sheet, meta };
}

/** Canvas -> PNG Blob. */
export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG 匯出失敗'));
    }, 'image/png');
  });
}
