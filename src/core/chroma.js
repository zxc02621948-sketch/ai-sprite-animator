// chroma.js — green-screen removal (framework-agnostic pure functions)
//
// Operates on raw RGBA pixel buffers (Uint8ClampedArray, same layout as
// ImageData.data). No DOM / canvas dependency, so the CLI build can reuse this
// verbatim on node-canvas / sharp pixel buffers.

/**
 * Convert an RGB triple to YCbCr chroma components (Cb, Cr).
 * Scaled to the 0..255 domain; luma is dropped (we key on chroma only, so
 * lighting differences across the green screen don't break the key).
 */
function rgbToCbCr(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = (b - y) * 0.565;
  const cr = (r - y) * 0.713;
  return [cb, cr];
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Hermite smoothstep between two edges.
function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Auto-detect the key colour by sampling border pixels (the frame edges are
 * almost always pure background) and taking the average of the "greenest" half.
 *
 * @param {Uint8ClampedArray} data RGBA buffer
 * @param {number} width
 * @param {number} height
 * @returns {{r:number,g:number,b:number}}
 */
export function detectKeyColor(data, width, height) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
  const push = (x, y) => {
    const i = (y * width + x) * 4;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < width; x += step) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    push(0, y);
    push(width - 1, y);
  }
  // Rank by "greenness" = G dominance; average the top half so a few stray
  // foreground pixels touching the border don't skew the key.
  samples.sort((a, b) => b[1] - (b[0] + b[2]) / 2 - (a[1] - (a[0] + a[2]) / 2));
  const half = Math.max(1, Math.floor(samples.length / 2));
  let r = 0, g = 0, bl = 0;
  for (let k = 0; k < half; k++) {
    r += samples[k][0];
    g += samples[k][1];
    bl += samples[k][2];
  }
  return { r: r / half, g: g / half, b: bl / half };
}

/**
 * Remove the green screen in place, writing alpha and suppressing green spill.
 *
 * @param {Uint8ClampedArray} data RGBA buffer, mutated in place
 * @param {number} width
 * @param {number} height
 * @param {object} opts
 * @param {{r:number,g:number,b:number}} [opts.keyColor] key colour; auto-detected if omitted
 * @param {number} [opts.similarity=0.35] distance below which a pixel is fully keyed (0..1)
 * @param {number} [opts.smoothness=0.10] soft-edge blend width added on top of similarity (0..1)
 * @param {number} [opts.spill=0.4] green-spill suppression strength (0..1)
 * @returns {{r:number,g:number,b:number}} the key colour actually used
 */
export function chromaKey(data, width, height, opts = {}) {
  const key = opts.keyColor || detectKeyColor(data, width, height);
  const similarity = opts.similarity ?? 0.35;
  const smoothness = opts.smoothness ?? 0.1;
  const spill = opts.spill ?? 0.4;

  const [kCb, kCr] = rgbToCbCr(key.r, key.g, key.b);
  // Normalise chroma distance into a rough 0..1 range. 178 ≈ max |Cb|,|Cr|
  // magnitude for saturated colours, so distances land in a usable band.
  const norm = 1 / 178;
  const edge0 = similarity;
  const edge1 = similarity + smoothness;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const [cb, cr] = rgbToCbCr(r, g, b);
    const dist = Math.hypot(cb - kCb, cr - kCr) * norm;

    // alpha: 0 near the key colour (background), 1 far from it (foreground).
    const alpha = smoothstep(edge0, edge1, dist);

    if (alpha <= 0) {
      data[i + 3] = 0;
      continue;
    }

    // Spill suppression: pull down residual green on kept/edge pixels so the
    // fringe doesn't stay green-tinted. Blend green toward the R/B average.
    if (spill > 0) {
      const avgRB = (r + b) / 2;
      if (g > avgRB) {
        data[i + 1] = g - (g - avgRB) * spill;
      }
    }

    data[i + 3] = alpha < 1 ? Math.round(alpha * 255) : 255;
  }

  return key;
}
