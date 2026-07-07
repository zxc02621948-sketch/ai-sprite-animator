// app.js — UI glue for the browser MVP.
import { loadVideo, extractFrames, disposeVideo } from './core/extract.js';
import { buildSpriteSheet, canvasToPngBlob } from './core/sheet.js';
import { chromaKey, detectKeyColor } from './core/chroma.js';

const $ = (id) => document.getElementById(id);

const state = {
  video: null,
  file: null,
  lastSheet: null, // { canvas, meta, blob }
  previewTimer: null,
  loopMs: 1000, // full-cycle preview duration; kept constant so frame count
                // changes smoothness, not apparent speed.
  autoLoopMs: 1000,
  startFrac: 0, // segment to sample from (0..1 of duration)
  endFrac: 1,
  trimScrubber: null,
};

// ---- input: drag & drop + file picker -------------------------------------
const drop = $('drop');
const fileInput = $('file');

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('drag');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

async function handleFile(file) {
  if (!file.type.startsWith('video/')) {
    setStatus('請選擇影片檔(mp4 / webm…)', true);
    return;
  }
  setStatus('讀取影片中…');
  if (state.trimScrubber) { state.trimScrubber.dispose(); state.trimScrubber = null; }
  if (state.video) disposeVideo(state.video);
  try {
    state.file = file;
    state.video = await loadVideo(file);
    const v = state.video;
    $('videoInfo').innerHTML =
      `已載入 <b>${file.name}</b> · ${v.videoWidth}×${v.videoHeight} · ${v.duration.toFixed(2)}s · ${(file.size / 1048576).toFixed(1)} MB`;
    buildTrimUI(v);
    $('run').disabled = false;
    setStatus('');
  } catch (err) {
    setStatus(err.message, true);
    $('run').disabled = true;
  }
}

// ---- trim / segment selection ---------------------------------------------
// Minimal: paint ONE still keyed frame at the dragged handle so you're not
// cutting blind. No playback, no frame extraction here — the real animation is
// the result preview after 生成. Uses a dedicated decode <video> and coalesces
// rapid drags (latest requested time wins).
function makeThumbScrubber(srcVideo, dur, canvas, ctx) {
  const decoder = document.createElement('video');
  decoder.muted = true;
  decoder.playsInline = true;
  decoder.src = srcVideo._objectUrl;
  const tmp = document.createElement('canvas'); // full-res scratch for keying
  let seeking = false, pending = null, keyColor = null;

  const draw = () => {
    const vw = decoder.videoWidth, vh = decoder.videoHeight;
    if (!vw) return;
    tmp.width = vw; tmp.height = vh;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.drawImage(decoder, 0, 0);
    if ($('removeBg').checked) {
      const id = tctx.getImageData(0, 0, vw, vh);
      if (!keyColor) keyColor = detectKeyColor(id.data, vw, vh);
      chromaKey(id.data, vw, vh, {
        similarity: +$('similarity').value,
        smoothness: +$('smoothness').value,
        spill: +$('spill').value,
        keyColor,
      });
      tctx.putImageData(id, 0, 0);
    }
    const sc = Math.min(canvas.width / vw, canvas.height / vh);
    const dw = vw * sc, dh = vh * sc;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  };
  const go = (t) => {
    if (decoder.readyState < 1) return; // not seekable yet; loadeddata primes it
    const target = Math.min(Math.max(0, t), Math.max(0, dur - 1e-3));
    // Already there (seek-to-0 when at 0 fires no 'seeked'): just redraw; also
    // avoids leaving `seeking` stuck true.
    if (decoder.readyState >= 2 && Math.abs(decoder.currentTime - target) < 1e-3) {
      try { draw(); } catch { /* not ready */ }
      return;
    }
    if (seeking) { pending = target; return; }
    seeking = true;
    decoder.currentTime = target;
  };
  decoder.addEventListener('seeked', () => {
    try { draw(); } catch { /* not ready */ }
    seeking = false;
    if (pending != null) { const t = pending; pending = null; go(t); }
  });
  // Prime the first frame; nudge off 0 so a real seek decodes/paints it.
  decoder.addEventListener('loadeddata', () => {
    const t0 = state.startFrac * dur;
    go(t0 < 0.02 ? Math.min(0.05, dur * 0.4) : t0);
  }, { once: true });

  return {
    seek: go,
    redraw: () => { if (decoder.readyState >= 2) { try { draw(); } catch {} } },
    dispose() { try { decoder.removeAttribute('src'); decoder.load(); } catch {} },
  };
}

function buildTrimUI(srcVideo) {
  const section = $('trimSection');
  const panel = $('trimPanel');
  const dur = srcVideo.duration;
  // Fit the thumbnail inside a fixed box so a big/portrait video doesn't blow up
  // the wide right column. Backing store == display size (no CSS upscaling).
  const maxBox = 360;
  const vw = srcVideo.videoWidth || 16, vh = srcVideo.videoHeight || 9;
  const fit = Math.min(maxBox / vw, maxBox / vh, 1);
  const dispW = Math.max(1, Math.round(vw * fit));
  const dispH = Math.max(1, Math.round(vh * fit));
  section.hidden = false;
  panel.innerHTML = `
    <canvas id="trimCanvas" class="checker" width="${dispW}" height="${dispH}" style="display:block;margin:0 auto;max-width:100%;border-radius:10px;"></canvas>
    <div class="field" style="margin:14px 0 0;">
      <label>起點 <span id="trimStartLabel">0.00s</span></label>
      <input id="trimStart" type="range" min="0" max="1000" value="0" />
    </div>
    <div class="field" style="margin:8px 0 0;">
      <label>終點 <span id="trimEndLabel">${dur.toFixed(2)}s</span></label>
      <input id="trimEnd" type="range" min="0" max="1000" value="1000" />
    </div>
    <div class="stats" id="trimSpan"></div>
    <div class="stats" style="margin-top:6px;color:var(--muted);">縮圖顯示目前把手的畫面(去背後)。抽格只會用這個範圍。動態請看生成後的結果預覽。</div>`;

  state.startFrac = 0;
  state.endFrac = 1;
  const startEl = $('trimStart');
  const endEl = $('trimEnd');
  const MIN_GAP = 0.02;
  const canvas = $('trimCanvas');
  const scrubber = makeThumbScrubber(srcVideo, dur, canvas, canvas.getContext('2d'));
  state.trimScrubber = scrubber;

  const update = (which) => {
    let s = +startEl.value / 1000;
    let e = +endEl.value / 1000;
    if (which === 'start' && s > e - MIN_GAP) { s = Math.max(0, e - MIN_GAP); startEl.value = Math.round(s * 1000); }
    if (which === 'end' && e < s + MIN_GAP) { e = Math.min(1, s + MIN_GAP); endEl.value = Math.round(e * 1000); }
    state.startFrac = s;
    state.endFrac = e;
    $('trimStartLabel').textContent = (s * dur).toFixed(2) + 's';
    $('trimEndLabel').textContent = (e * dur).toFixed(2) + 's';
    $('trimSpan').textContent = `片段長度 ${((e - s) * dur).toFixed(2)}s / 全片 ${dur.toFixed(2)}s`;
    scrubber.seek((which === 'end' ? e : s) * dur);
  };
  startEl.addEventListener('input', () => update('start'));
  endEl.addEventListener('input', () => update('end'));
  update('start');
}

// ---- frame-count presets ---------------------------------------------------
$('framePresets').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-frames]');
  if (!btn) return;
  [...$('framePresets').children].forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  $('frameCount').value = btn.dataset.frames;
});
$('frameCount').addEventListener('input', () => {
  [...$('framePresets').children].forEach((b) =>
    b.classList.toggle('active', b.dataset.frames === $('frameCount').value));
});

// ---- slider value readouts + enable/disable chroma -------------------------
for (const id of ['similarity', 'smoothness', 'spill']) {
  const el = $(id);
  const out = $(id + 'Val');
  el.addEventListener('input', () => { out.textContent = (+el.value).toFixed(2); });
}
$('removeBg').addEventListener('change', () => {
  $('chromaControls').style.opacity = $('removeBg').checked ? '1' : '.4';
  $('chromaControls').style.pointerEvents = $('removeBg').checked ? 'auto' : 'none';
});

// ---- run -------------------------------------------------------------------
$('run').addEventListener('click', run);

async function run() {
  if (!state.video) return;
  const count = Math.max(1, Math.min(120, parseInt($('frameCount').value) || 12));
  $('run').disabled = true;
  $('progWrap').hidden = false;
  setProgress(0);
  setStatus('抽格中…');

  try {
    const { frames } = await extractFrames(state.video, count, {
      startFraction: state.startFrac,
      endFraction: state.endFrac,
      onProgress: (done, total) => {
        setProgress((done / total) * 0.7);
        setStatus(`抽格 ${done}/${total}…`);
      },
    });

    setStatus('去背 + trim + 打包中…');
    // Yield so the progress paint lands before the heavy synchronous work.
    await new Promise((r) => setTimeout(r, 20));

    const { canvas, meta } = buildSpriteSheet(frames, {
      removeBackground: $('removeBg').checked,
      chroma: {
        similarity: +$('similarity').value,
        smoothness: +$('smoothness').value,
        spill: +$('spill').value,
      },
      cellSize: parseInt($('cellSize').value) || 0,
      columns: parseInt($('columns').value) || 0,
      pad: parseInt($('pad').value) || 0,
      gap: parseInt($('gap').value) || 0,
      pingpong: $('pingpong').checked,
    });

    // Auto preview speed = real-time. Each sampled frame covers
    // (selected span / sampled count) seconds; hold every cell that long so the
    // loop replays the source motion 1:1 — correct for ping-pong too, since its
    // extra cells reuse the same per-frame duration.
    const spannedSec = (state.endFrac - state.startFrac) * state.video.duration;
    const perFrameMs = (spannedSec * 1000) / count;
    state.autoLoopMs = Math.max(200, Math.round(perFrameMs * meta.frameCount));
    state.loopMs = state.autoLoopMs;

    setProgress(0.9);
    setStatus('匯出 PNG…');
    const blob = await canvasToPngBlob(canvas);
    state.lastSheet = { canvas, meta, blob };

    setProgress(1);
    renderOutput();
    setStatus('完成 ✓');
  } catch (err) {
    console.error(err);
    setStatus(err.message || '生成失敗', true);
  } finally {
    $('run').disabled = false;
    setTimeout(() => { $('progWrap').hidden = true; setProgress(0); }, 600);
  }
}

// ---- output render ---------------------------------------------------------
function renderOutput() {
  const { canvas, meta, blob } = state.lastSheet;
  const out = $('output');
  out.innerHTML = `
    <div id="sheetWrap" class="checker"></div>
    <div class="preview-row">
      <div>
        <canvas id="previewCanvas" class="checker" width="180" height="180"></canvas>
        <div class="field" style="margin:8px 0 0;width:180px;">
          <label style="display:flex;justify-content:space-between;align-items:baseline;">
            <span>動畫預覽速度 <button id="speedAuto" style="font-size:11px;padding:2px 7px;border-radius:6px;border:1px solid var(--line);background:var(--panel-2);color:var(--accent);cursor:pointer;">自動</button></span>
            <span class="slider-val" id="speedVal"></span>
          </label>
          <input id="speed" type="range" min="100" max="${Math.max(3000, Math.round((state.autoLoopMs || 1000) * 1.6))}" step="50" value="${state.loopMs}" />
        </div>
      </div>
      <div class="stats" id="metaStats"></div>
    </div>
    <div class="actions">
      <button class="ghost" id="dlPng">⬇ 下載 PNG</button>
      <button class="ghost" id="dlJson">⬇ 下載 JSON(格座標)</button>
      <label class="switch" style="margin-left:auto;"><input id="playToggle" type="checkbox" checked/> 播放</label>
    </div>`;

  $('sheetWrap').appendChild(canvas);
  canvas.id = 'sheetCanvas';

  $('metaStats').innerHTML =
    `尺寸 <b>${meta.sheetWidth}×${meta.sheetHeight}</b><br />` +
    `每格 <b>${meta.cellWidth}×${meta.cellHeight}</b> · 網格 <b>${meta.columns}×${meta.rows}</b><br />` +
    `影格 <b>${meta.frameCount}</b>${meta.pingpong ? ` <span style="color:var(--accent)">(乒乓 ${meta.sampledFrames}→${meta.frameCount})</span>` : ''} · PNG <b>${(blob.size / 1024).toFixed(1)} KB</b><br />` +
    (meta.keyColor ? `去背色 rgb(${meta.keyColor.r}, ${meta.keyColor.g}, ${meta.keyColor.b})` : '未去背');

  $('dlPng').addEventListener('click', () => download(blob, baseName() + '.png'));
  $('dlJson').addEventListener('click', () =>
    download(new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }), baseName() + '.json'));

  const toggle = $('playToggle');
  toggle.addEventListener('change', () => toggle.checked ? startPreview() : stopPreview());

  const speed = $('speed');
  speed.addEventListener('input', () => {
    state.loopMs = +speed.value;
    updateSpeedLabel();
    if (toggle.checked) startPreview();
  });
  $('speedAuto').addEventListener('click', () => {
    state.loopMs = state.autoLoopMs;
    speed.value = state.autoLoopMs;
    updateSpeedLabel();
    if (toggle.checked) startPreview();
  });
  updateSpeedLabel();
  startPreview();
}

function updateSpeedLabel() {
  const meta = state.lastSheet?.meta;
  if (!meta) return;
  const fps = Math.round((meta.frameCount / state.loopMs) * 1000);
  const atAuto = Math.abs(state.loopMs - state.autoLoopMs) < 30;
  $('speedVal').textContent = `${(state.loopMs / 1000).toFixed(2)}s／圈 ≈ ${fps}fps${atAuto ? ' · 原速' : ''}`;
}

// Animated preview: cycle through all frames over a CONSTANT loop duration, so
// changing the frame count changes smoothness — not apparent speed.
function startPreview() {
  stopPreview();
  const { canvas, meta } = state.lastSheet;
  const pv = $('previewCanvas');
  const ctx = pv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const box = pv.width;
  const scale = Math.min(box / meta.cellWidth, box / meta.cellHeight);
  const dw = meta.cellWidth * scale;
  const dh = meta.cellHeight * scale;
  const dx = (box - dw) / 2;
  const dy = (box - dh) / 2;
  let i = 0;
  const draw = () => {
    const f = meta.frames[i % meta.frames.length];
    ctx.clearRect(0, 0, box, box);
    ctx.drawImage(canvas, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
    i++;
  };
  draw();
  // interval per frame = whole-loop duration / frame count.
  state.previewTimer = setInterval(draw, state.loopMs / meta.frames.length);
}
function stopPreview() {
  if (state.previewTimer) { clearInterval(state.previewTimer); state.previewTimer = null; }
}

// ---- helpers ---------------------------------------------------------------
function baseName() {
  const n = state.file?.name?.replace(/\.[^.]+$/, '') || 'sprite';
  return n + '_sheet';
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function setStatus(msg, err = false) {
  const s = $('status');
  s.textContent = msg;
  s.classList.toggle('err', err);
}
function setProgress(p) { $('prog').style.width = (p * 100).toFixed(0) + '%'; }
