// pack.js — decide the grid layout for N frames of a fixed cell size.
//
// Sprite sheets for game engines are almost always a uniform grid (engines
// index frames by row/col), so we pack into a regular grid rather than a
// free-form bin. The lever here is: keep the grid tight to avoid wasted rows.

/**
 * Choose columns/rows for a frame count.
 *
 * @param {number} count number of frames
 * @param {object} [opts]
 * @param {number} [opts.columns] force a column count; rows derived from it
 * @returns {{columns:number, rows:number}}
 */
export function gridFor(count, opts = {}) {
  if (opts.columns && opts.columns > 0) {
    return { columns: opts.columns, rows: Math.ceil(count / opts.columns) };
  }
  // Default: as square as possible, favouring a wider sheet (engines and
  // texture hardware prefer width >= height).
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return { columns, rows };
}

/**
 * Compute the pixel rectangle for each frame in a uniform grid.
 *
 * @param {number} count
 * @param {number} cellW cell width in px
 * @param {number} cellH cell height in px
 * @param {object} [opts]
 * @param {number} [opts.columns] force column count
 * @param {number} [opts.gap=0] transparent gap between cells (px)
 * @returns {{columns,rows,cellW,cellH,gap,sheetW,sheetH,cells:Array<{x,y,w,h,col,row}>}}
 */
export function layout(count, cellW, cellH, opts = {}) {
  const gap = opts.gap ?? 0;
  const { columns, rows } = gridFor(count, opts);
  const sheetW = columns * cellW + (columns - 1) * gap;
  const sheetH = rows * cellH + (rows - 1) * gap;
  const cells = [];
  for (let n = 0; n < count; n++) {
    const col = n % columns;
    const row = Math.floor(n / columns);
    cells.push({
      col,
      row,
      x: col * (cellW + gap),
      y: row * (cellH + gap),
      w: cellW,
      h: cellH,
    });
  }
  return { columns, rows, cellW, cellH, gap, sheetW, sheetH, cells };
}
