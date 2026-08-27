import { GIFEncoder, quantize, applyPalette } from 'https://unpkg.com/gifenc@1.0.3?module';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const ui = {
  headline: $('headline'), fontFamily: $('fontFamily'), logoFile: $('logoFile'),
  duration: $('duration'), fps: $('fps'), textDelay: $('textDelay'), textDelayOut: $('textDelayOut'),
  x1: $('x1'), y1: $('y1'), x2: $('x2'), y2: $('y2'), preset: $('preset'),
  logoY: $('logoY'), logoScale: $('logoScale'), textY: $('textY'), textScale: $('textScale'),
  playBtn: $('playBtn'), restartBtn: $('restartBtn'), scrubber: $('scrubber'), timeReadout: $('timeReadout'),
  exportBtn: $('exportBtn'), exportProgress: $('exportProgress'), status: $('status'),
  curvePath: $('curvePath'), guide1: $('guide1'), guide2: $('guide2'), handle1: $('handle1'), handle2: $('handle2')
};

let logoImage = null;
let playhead = 0;
let isPlaying = false;
let rafId = null;
let playbackStartedAt = 0;
let playbackOffsetMs = 0;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const num = (input, fallback) => Number.isFinite(Number(input.value)) ? Number(input.value) : fallback;

function bezierCoord(t, a1, a2) {
  const omt = 1 - t;
  return 3 * omt * omt * t * a1 + 3 * omt * t * t * a2 + t * t * t;
}

function bezierDerivative(t, a1, a2) {
  const omt = 1 - t;
  return 3 * omt * omt * a1 + 6 * omt * t * (a2 - a1) + 3 * t * t * (1 - a2);
}

function cubicBezierEase(x, x1, y1, x2, y2) {
  x = clamp(x, 0, 1);
  let t = x;
  for (let i = 0; i < 7; i++) {
    const error = bezierCoord(t, x1, x2) - x;
    const slope = bezierDerivative(t, x1, x2);
    if (Math.abs(error) < 1e-6 || Math.abs(slope) < 1e-6) break;
    t = clamp(t - error / slope, 0, 1);
  }
  let low = 0, high = 1;
  for (let i = 0; i < 12; i++) {
    const current = bezierCoord(t, x1, x2);
    if (Math.abs(current - x) < 1e-6) break;
    if (current < x) low = t; else high = t;
    t = (low + high) / 2;
  }
  return bezierCoord(t, y1, y2);
}

function state() {
  return {
    headline: ui.headline.value || ' ',
    fontFamily: ui.fontFamily.value.trim() || 'Arial',
    duration: clamp(num(ui.duration, 1400), 100, 10000),
    fps: clamp(Math.round(num(ui.fps, 30)), 8, 60),
    textDelay: clamp(num(ui.textDelay, 0.14), 0, 0.8),
    bezier: [
      clamp(num(ui.x1, 0.22), 0, 1), num(ui.y1, 1),
      clamp(num(ui.x2, 0.36), 0, 1), num(ui.y2, 1)
    ],
    logoY: num(ui.logoY, 70),
    logoScale: num(ui.logoScale, 0.82),
    textY: num(ui.textY, 55),
    textScale: num(ui.textScale, 0.94)
  };
}

function localProgress(globalT, delay) {
  if (delay >= 1) return globalT >= 1 ? 1 : 0;
  return clamp((globalT - delay) / (1 - delay), 0, 1);
}

function eased(t, s) {
  return cubicBezierEase(t, ...s.bezier);
}

function drawPlaceholderLogo(context, x, y, scale, alpha) {
  context.save();
  context.globalAlpha = alpha;
  context.translate(x, y);
  context.scale(scale, scale);
  context.fillStyle = '#ffffff';
  context.fillRect(-68, -34, 136, 68);
  context.fillStyle = '#111214';
  context.font = '700 25px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('LOGO', 0, 1);
  context.restore();
}

function drawLogo(context, x, y, scale, alpha) {
  if (!logoImage) return drawPlaceholderLogo(context, x, y, scale, alpha);
  const maxW = 190;
  const maxH = 100;
  const ratio = Math.min(maxW / logoImage.naturalWidth, maxH / logoImage.naturalHeight);
  const w = logoImage.naturalWidth * ratio;
  const h = logoImage.naturalHeight * ratio;
  context.save();
  context.globalAlpha = alpha;
  context.translate(x, y);
  context.scale(scale, scale);
  context.drawImage(logoImage, -w / 2, -h / 2, w, h);
  context.restore();
}

function fitHeadlineFont(context, text, fontFamily, maxWidth) {
  let size = 64;
  while (size > 18) {
    context.font = `800 ${size}px ${fontFamily}`;
    if (context.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function renderFrame(t, targetCtx = ctx, width = canvas.width, height = canvas.height) {
  const s = state();
  targetCtx.save();
  targetCtx.clearRect(0, 0, width, height);
  targetCtx.fillStyle = '#f1f1ee';
  targetCtx.fillRect(0, 0, width, height);

  const logoT = eased(clamp(t, 0, 1), s);
  const textRaw = localProgress(t, s.textDelay);
  const textT = eased(textRaw, s);

  const logoAlpha = clamp(logoT, 0, 1);
  const logoScale = lerp(s.logoScale, 1, logoT);
  const logoY = height * 0.39 + lerp(s.logoY, 0, logoT);
  drawLogo(targetCtx, width / 2, logoY, logoScale, logoAlpha);

  const textAlpha = clamp(textT, 0, 1);
  const textScale = lerp(s.textScale, 1, textT);
  const textY = height * 0.67 + lerp(s.textY, 0, textT);
  const fontSize = fitHeadlineFont(targetCtx, s.headline, s.fontFamily, width * 0.82);

  targetCtx.save();
  targetCtx.globalAlpha = textAlpha;
  targetCtx.translate(width / 2, textY);
  targetCtx.scale(textScale, textScale);
  targetCtx.fillStyle = '#111214';
  targetCtx.font = `800 ${fontSize}px ${s.fontFamily}`;
  targetCtx.textAlign = 'center';
  targetCtx.textBaseline = 'middle';
  targetCtx.fillText(s.headline, 0, 0);
  targetCtx.restore();

  targetCtx.restore();
}

function syncTimeline() {
  const s = state();
  ui.scrubber.value = String(playhead);
  ui.timeReadout.value = `${(playhead * s.duration / 1000).toFixed(2)} s`;
  renderFrame(playhead);
}

function tick(now) {
  if (!isPlaying) return;
  const s = state();
  const elapsed = now - playbackStartedAt + playbackOffsetMs;
  playhead = clamp(elapsed / s.duration, 0, 1);
  syncTimeline();
  if (playhead >= 1) {
    isPlaying = false;
    ui.playBtn.textContent = 'Play';
    rafId = null;
    return;
  }
  rafId = requestAnimationFrame(tick);
}

function play() {
  if (isPlaying) {
    isPlaying = false;
    ui.playBtn.textContent = 'Play';
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    playbackOffsetMs = playhead * state().duration;
    return;
  }
  if (playhead >= 1) playhead = 0;
  playbackOffsetMs = playhead * state().duration;
  playbackStartedAt = performance.now();
  isPlaying = true;
  ui.playBtn.textContent = 'Pause';
  rafId = requestAnimationFrame(tick);
}

function restart() {
  isPlaying = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  playhead = 0;
  playbackOffsetMs = 0;
  ui.playBtn.textContent = 'Play';
  syncTimeline();
}

function updateCurveViz() {
  const s = state();
  const [x1, y1, x2, y2] = s.bezier;
  const left = 20, right = 240, top = 20, bottom = 150;
  const sx = (x) => left + x * (right - left);
  const sy = (y) => bottom - ((y + 0.25) / 1.5) * (bottom - top);
  const start = [sx(0), sy(0)];
  const p1 = [sx(x1), sy(y1)];
  const p2 = [sx(x2), sy(y2)];
  const end = [sx(1), sy(1)];
  ui.curvePath.setAttribute('d', `M${start[0]} ${start[1]} C${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]} ${end[0]} ${end[1]}`);
  ui.guide1.setAttribute('d', `M${start[0]} ${start[1]} L${p1[0]} ${p1[1]}`);
  ui.guide2.setAttribute('d', `M${end[0]} ${end[1]} L${p2[0]} ${p2[1]}`);
  ui.handle1.setAttribute('cx', p1[0]); ui.handle1.setAttribute('cy', p1[1]);
  ui.handle2.setAttribute('cx', p2[0]); ui.handle2.setAttribute('cy', p2[1]);
}

function anyControlChanged() {
  ui.textDelayOut.value = `${Math.round(num(ui.textDelay, 0.14) * 100)}%`;
  updateCurveViz();
  renderFrame(playhead);
}

ui.playBtn.addEventListener('click', play);
ui.restartBtn.addEventListener('click', restart);
ui.scrubber.addEventListener('input', () => {
  isPlaying = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  ui.playBtn.textContent = 'Play';
  playhead = clamp(Number(ui.scrubber.value), 0, 1);
  playbackOffsetMs = playhead * state().duration;
  syncTimeline();
});

ui.preset.addEventListener('change', () => {
  if (ui.preset.value === 'custom') return;
  const [x1, y1, x2, y2] = ui.preset.value.split(',').map(Number);
  ui.x1.value = x1; ui.y1.value = y1; ui.x2.value = x2; ui.y2.value = y2;
  anyControlChanged();
});

[ui.x1, ui.y1, ui.x2, ui.y2].forEach((el) => el.addEventListener('input', () => {
  ui.preset.value = 'custom';
  anyControlChanged();
}));

[
  ui.headline, ui.fontFamily, ui.duration, ui.fps, ui.textDelay,
  ui.logoY, ui.logoScale, ui.textY, ui.textScale
].forEach((el) => el.addEventListener('input', anyControlChanged));

ui.logoFile.addEventListener('change', () => {
  const file = ui.logoFile.files?.[0];
  if (!file) { logoImage = null; renderFrame(playhead); return; }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    logoImage = image;
    URL.revokeObjectURL(url);
    renderFrame(playhead);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    ui.status.textContent = 'Could not read that image.';
  };
  image.src = url;
});

async function exportGif() {
  const s = state();
  const totalFrames = Math.max(2, Math.round((s.duration / 1000) * s.fps));
  const delay = Math.round(1000 / s.fps);
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const exportCtx = exportCanvas.getContext('2d', { willReadFrequently: true });
  const gif = GIFEncoder();

  ui.exportBtn.disabled = true;
  ui.exportProgress.value = 0;
  ui.status.textContent = `Rendering ${totalFrames} frames…`;

  try {
    for (let i = 0; i < totalFrames; i++) {
      const t = totalFrames === 1 ? 1 : i / (totalFrames - 1);
      renderFrame(t, exportCtx, exportCanvas.width, exportCanvas.height);
      const rgba = exportCtx.getImageData(0, 0, exportCanvas.width, exportCanvas.height).data;
      const palette = quantize(rgba, 256, { format: 'rgb565' });
      const indexed = applyPalette(rgba, palette, 'rgb565');
      gif.writeFrame(indexed, exportCanvas.width, exportCanvas.height, { palette, delay, repeat: 0 });
      ui.exportProgress.value = (i + 1) / totalFrames;
      ui.status.textContent = `Encoding frame ${i + 1} / ${totalFrames}…`;
      if (i % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    gif.finish();
    const bytes = gif.bytes();
    const blob = new Blob([bytes], { type: 'image/gif' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anim-bezier-${Date.now()}.gif`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ui.status.textContent = `Done — ${(blob.size / 1024 / 1024).toFixed(1)} MB GIF.`;
  } catch (error) {
    console.error(error);
    ui.status.textContent = `Export failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    ui.exportBtn.disabled = false;
  }
}

ui.exportBtn.addEventListener('click', exportGif);

updateCurveViz();
syncTimeline();
