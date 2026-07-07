// trim.js — find the opaque bounding box of a frame and crop to it.
//
// This is the file-size lever the spec calls out: don't waste pixels on the
// transparent margins around the sprite. Pure functions over RGBA buffers.

/**
 * Find the tight bounding box of pixels whose alpha exceeds `alphaThreshold`.
 *
 * @param {Uint8ClampedArray} data RGBA buffer
 * @param {number} width
 * @param {number} height
 * @param {number} [alphaThreshold=0] pixels with alpha <= this are treated as empty
 * @returns {{x:number,y:number,w:number,h:number}|null} null if the frame is fully empty
 */
export function opaqueBounds(data, width, height, alphaThreshold = 0) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Union of several bounds boxes. Used to trim every frame to a single shared
 * box, so the sprite stays registered (doesn't jitter) across the sheet while
 * still dropping the empty margin common to all frames.
 *
 * @param {Array<{x,y,w,h}|null>} boxes
 * @returns {{x,y,w,h}|null}
 */
export function unionBounds(boxes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const box of boxes) {
    if (!box) continue;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w - 1);
    maxY = Math.max(maxY, box.y + box.h - 1);
  }
  if (maxX === -Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Grow a box by `pad` pixels on every side, clamped to the frame.
 */
export function padBounds(box, pad, width, height) {
  if (!box || pad <= 0) return box;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const maxX = Math.min(width - 1, box.x + box.w - 1 + pad);
  const maxY = Math.min(height - 1, box.y + box.h - 1 + pad);
  return { x, y, w: maxX - x + 1, h: maxY - y + 1 };
}
