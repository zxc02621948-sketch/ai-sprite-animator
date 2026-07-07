// extract.js — pull N evenly-spaced frames from a video (browser build).
//
// Uses the browser's native <video> decode + canvas readback instead of
// ffmpeg.wasm: no SharedArrayBuffer, no COOP/COEP headers, deploys to any
// static host. Each extracted frame is at the video's FULL resolution — this
// is the "don't slice one big image" decision from the spec: resolution per
// frame is independent of how many frames we take, so more frames never blurs.

/**
 * Load a File/Blob into a <video> element and wait until it can seek.
 * @param {File|Blob} file
 * @returns {Promise<HTMLVideoElement>}
 */
export function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    video._objectUrl = url;
    const onReady = () => {
      if (video.readyState >= 1 && video.videoWidth > 0) {
        cleanup();
        resolve(video);
      }
    };
    const onError = () => {
      cleanup();
      URL.revokeObjectURL(url);
      reject(new Error('影片無法解碼(格式可能不被瀏覽器支援,建議 mp4/H.264 或 webm)'));
    };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onError);
  });
}

/**
 * Seek a video to `time` (seconds) and resolve only once the new frame is
 * actually PRESENTED — not merely when `seeked` fires. On real encoded video the
 * decoded frame often isn't painted yet at `seeked`, so an immediate drawImage
 * grabs the previous frame → duplicated / out-of-order frames → playback jitter.
 * We wait one requestVideoFrameCallback (with a timeout fallback) to be sure.
 */
function seekTo(video, time) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onSeeked = () => {
      if (typeof video.requestVideoFrameCallback === 'function') {
        // Fires when the seeked frame is handed to the compositor.
        const fb = setTimeout(finish, 150); // fallback (e.g. background tab)
        video.requestVideoFrameCallback(() => { clearTimeout(fb); finish(); });
      } else {
        setTimeout(finish, 40);
      }
    };
    const onError = () => { cleanup(); reject(new Error('seek 失敗 @ ' + time.toFixed(3) + 's')); };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    // Clamp inside duration; nudge off exact-end to avoid a blank final frame.
    video.currentTime = Math.min(time, Math.max(0, video.duration - 1e-3));
  });
}

/**
 * Extract `count` frames as ImageData, evenly spaced across the clip.
 *
 * @param {HTMLVideoElement} video a video already loaded via loadVideo()
 * @param {number} count number of frames to grab
 * @param {object} [opts]
 * @param {number} [opts.startFraction=0] where to start (0..1 of duration)
 * @param {number} [opts.endFraction=1] where to stop (0..1 of duration)
 * @param {(done:number,total:number)=>void} [opts.onProgress]
 * @returns {Promise<{width:number,height:number,frames:ImageData[]}>}
 */
export async function extractFrames(video, count, opts = {}) {
  const startF = opts.startFraction ?? 0;
  const endF = opts.endFraction ?? 1;
  const duration = video.duration;
  const width = video.videoWidth;
  const height = video.videoHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const start = startF * duration;
  const end = endF * duration;
  const span = Math.max(0, end - start);

  const frames = [];
  for (let n = 0; n < count; n++) {
    // Sample at the centre of each of `count` equal slices, so frames are
    // evenly distributed and we never land exactly on 0 or the very end.
    const t = count === 1 ? start : start + (span * (n + 0.5)) / count;
    await seekTo(video, t);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(video, 0, 0, width, height);
    frames.push(ctx.getImageData(0, 0, width, height));
    if (opts.onProgress) opts.onProgress(n + 1, count);
  }

  return { width, height, frames };
}

/** Release the object URL created by loadVideo(). */
export function disposeVideo(video) {
  if (video && video._objectUrl) {
    URL.revokeObjectURL(video._objectUrl);
    video._objectUrl = null;
  }
}
