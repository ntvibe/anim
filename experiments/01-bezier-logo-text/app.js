import { GIFEncoder, quantize, applyPalette } from 'https://unpkg.com/gifenc@1.0.3?module';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const ui = {
  headline: $('headline'), fontFamily: $('fontFamily'), loadFontBtn: $('loadFontBtn'), fontStatus: $('fontStatus'), googleFontStylesheet: $('googleFontStylesheet'), logoFile: $('logoFile'),
  bgColor: $('bgColor'), logoSize: $('logoSize'), marginX: $('marginX'), marginY: $('marginY'), showMargins: $('showMargins'),
  duration: $('duration'), fps: $('fps'), logoStart: $('logoStart'), logoEnd: $('logoEnd'), textStart: $('textStart'), textEnd: $('textEnd'),
  logoTimingLabel: $('logoTimingLabel'), textTimingLabel: $('textTimingLabel'), timeline: $('timeline'),
  x1: $('x1'), y1: $('y1'), x2: $('x2'), y2: $('y2'), preset: $('preset'),
  logoY: $('logoY'), logoScale: $('logoScale'), textY: $('textY'), textScale: $('textScale'),
  playBtn: $('playBtn'), restartBtn: $('restartBtn'), scrubber: $('scrubber'), timeReadout: $('timeReadout'),
  exportBtn: $('exportBtn'), exportProgress: $('exportProgress'), status: $('status'),
  curvePath: $('curvePath'), guide1: $('guide1'), guide2: $('guide2'), handle1: $('handle1'), handle2: $('handle2')
};

let logoImage = null;
let logoObjectUrl = null;
let playhead = 0;
let isPlaying = false;
let rafId = null;
let playbackStartedAt = 0;
let playbackOffsetMs = 0;
let fontLoadToken = 0;

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

function normalizedRange(startInput, endInput, fallbackStart, fallbackEnd) {
  let start = clamp(num(startInput, fallbackStart), 0, 99);
  let end = clamp(num(endInput, fallbackEnd), 1, 100);
  if (end <= start) end = Math.min(100, start + 1);
  if (start >= end) start = Math.max(0, end - 1);
  startInput.value = String(Math.round(start));
  endInput.value = String(Math.round(end));
  return [start / 100, end / 100];
}

function state() {
  const [logoStart, logoEnd] = normalizedRange(ui.logoStart, ui.logoEnd, 0, 65);
  const [textStart, textEnd] = normalizedRange(ui.textStart, ui.textEnd, 14, 100);
  return {
    headline: ui.headline.value || ' ',
    fontFamily: ui.fontFamily.value.trim() || 'Anton',
    bgColor: ui.bgColor.value || '#f1f1ee',
    logoSize: clamp(num(ui.logoSize, 190), 20, 700),
    marginX: clamp(num(ui.marginX, 60), 0, canvas.width / 2 - 10),
    marginY: clamp(num(ui.marginY, 40), 0, canvas.height / 2 - 10),
    showMargins: ui.showMargins.checked,
    duration: clamp(num(ui.duration, 1400), 100, 10000),
    fps: clamp(Math.round(num(ui.fps, 30)), 8, 60),
    logoStart, logoEnd, textStart, textEnd,
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

function localProgress(globalT, start, end) {
  if (end <= start) return globalT >= end ? 1 : 0;
  return clamp((globalT - start) / (end - start), 0, 1);
}

function eased(t, s) {
  return cubicBezierEase(t, ...s.bezier);
}

function drawPlaceholderLogo(context, x, y, scale, alpha, targetWidth) {
  const w = targetWidth;
  const h = targetWidth * 0.5;
  context.save();
  context.globalAlpha = alpha;
  context.translate(x, y);
  context.scale(scale, scale);
  context.fillStyle = '#ffffff';
  context.fillRect(-w / 2, -h / 2, w, h);
  context.fillStyle = '#111214';
  context.font = `700 ${Math.max(12, targetWidth * 0.13)}px Arial`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('LOGO', 0, 1);
  context.restore();
}

function drawLogo(context, x, y, scale, alpha, targetWidth, maxHeight) {
  if (!logoImage) return drawPlaceholderLogo(context, x, y, scale, alpha, targetWidth);
  const naturalWidth = logoImage.naturalWidth || logoImage.width || targetWidth;
  const naturalHeight = logoImage.naturalHeight || logoImage.height || targetWidth;
  const ratio = Math.min(targetWidth / naturalWidth, maxHeight / naturalHeight);
  const w = naturalWidth * ratio;
  const h = naturalHeight * ratio;
  context.save();
  context.globalAlpha = alpha;
  context.translate(x, y);
  context.scale(scale, scale);
  context.drawImage(logoImage, -w / 2, -h / 2, w, h);
  context.restore();
}

function canvasFont(fontFamily, size) {
  const quoted = fontFamily.includes(' ') ? `"${fontFamily}"` : fontFamily;
  return `400 ${size}px ${quoted}, Arial, sans-serif`;
}

function fitHeadlineFont(context, text, fontFamily, maxWidth) {
  let size = 72;
  while (size > 18) {
    context.font = canvasFont(fontFamily, size);
    if (context.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function drawMarginGuides(context, width, height, marginX, marginY) {
  context.save();
  context.strokeStyle = 'rgba(20,20,22,.22)';
  context.lineWidth = 1;
  context.setLineDash([6, 6]);
  context.strokeRect(marginX + 0.5, marginY + 0.5, Math.max(0, width - marginX * 2 - 1), Math.max(0, height - marginY * 2 - 1));
  context.restore();
}

function renderFrame(t, targetCtx = ctx, width = canvas.width, height = canvas.height, options = {}) {
  const s = state();
  targetCtx.save();
  targetCtx.clearRect(0, 0, width, height);
  targetCtx.fillStyle = s.bgColor;
  targetCtx.fillRect(0, 0, width, height);

  const scaleX = width / canvas.width;
  const scaleY = height / canvas.height;
  const marginX = s.marginX * scaleX;
  const marginY = s.marginY * scaleY;
  const contentWidth = Math.max(40, width - marginX * 2);
  const contentHeight = Math.max(40, height - marginY * 2);

  const logoRaw = localProgress(t, s.logoStart, s.logoEnd);
  const textRaw = localProgress(t, s.textStart, s.textEnd);
  const logoT = eased(logoRaw, s);
  const textT = eased(textRaw, s);

  const logoAlpha = clamp(logoT, 0, 1);
  const logoScale = lerp(s.logoScale, 1, logoT);
  const logoBaseY = marginY + contentHeight * 0.36;
  const logoY = logoBaseY + lerp(s.logoY * scaleY, 0, logoT);
  const logoWidth = Math.min(s.logoSize * scaleX, contentWidth);
  drawLogo(targetCtx, width / 2, logoY, logoScale, logoAlpha, logoWidth, contentHeight * 0.38);

  const textAlpha = clamp(textT, 0, 1);
  const textScale = lerp(s.textScale, 1, textT);
  const textBaseY = marginY + contentHeight * 0.70;
  const textY = textBaseY + lerp(s.textY * scaleY, 0, textT);
  const fontSize = fitHeadlineFont(targetCtx, s.headline, s.fontFamily, contentWidth);

  targetCtx.save();
  targetCtx.globalAlpha = textAlpha;
  targetCtx.translate(width / 2, textY);
  targetCtx.scale(textScale, textScale);
  targetCtx.fillStyle = '#111214';
  targetCtx.font = canvasFont(s.fontFamily, fontSize);
  targetCtx.textAlign = 'center';
  targetCtx.textBaseline = 'middle';
  targetCtx.fillText(s.headline, 0, 0);
  targetCtx.restore();

  if (s.showMargins && !options.exporting) drawMarginGuides(targetCtx, width, height, marginX, marginY);
  targetCtx.restore();
}

function syncTimeline() {
  const s = state();
  ui.scrubber.value = String(playhead);
  ui.timeReadout.value = `${(playhead * s.duration / 1000).toFixed(2)} s`;
  const firstTrack = document.querySelector('[data-track="logo"]');
  if (firstTrack) {
    const timelineRect = ui.timeline.getBoundingClientRect();
    const trackRect = firstTrack.getBoundingClientRect();
    const left = trackRect.left - timelineRect.left + playhead * trackRect.width;
    ui.timeline.style.setProperty('--playhead-px', `${left}px`);
  }
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

function updateTimingVisuals() {
  const ranges = {
    logo: [Number(ui.logoStart.value), Number(ui.logoEnd.value)],
    text: [Number(ui.textStart.value), Number(ui.textEnd.value)]
  };
  for (const [layer, [start, end]] of Object.entries(ranges)) {
    const bar = document.querySelector(`[data-bar="${layer}"]`);
    const safeStart = clamp(Number.isFinite(start) ? start : 0, 0, 99);
    const safeEnd = clamp(Number.isFinite(end) ? end : 100, safeStart + 1, 100);
    bar.style.left = `${safeStart}%`;
    bar.style.width = `${safeEnd - safeStart}%`;
    ui[`${layer}TimingLabel`].textContent = `${Math.round(safeStart)}–${Math.round(safeEnd)}%`;
  }
}

function anyControlChanged() {
  state();
  updateCurveViz();
  updateTimingVisuals();
  renderFrame(playhead);
}

async function loadGoogleFont() {
  const family = ui.fontFamily.value.trim() || 'Anton';
  const token = ++fontLoadToken;
  const encoded = encodeURIComponent(family).replace(/%20/g, '+');
  ui.fontStatus.textContent = `Loading ${family}…`;
  ui.googleFontStylesheet.href = `https://fonts.googleapis.com/css2?family=${encoded}&display=swap`;
  try {
    await document.fonts.load(`32px "${family}"`);
    if (token !== fontLoadToken) return;
    ui.fontStatus.textContent = `${family} loaded from Google Fonts.`;
    renderFrame(playhead);
  } catch (error) {
    if (token !== fontLoadToken) return;
    console.error(error);
    ui.fontStatus.textContent = `Could not confirm ${family}. Check the Google Fonts family name.`;
  }
}

function setTiming(layer, start, end) {
  start = clamp(start, 0, 99);
  end = clamp(end, start + 1, 100);
  ui[`${layer}Start`].value = String(Math.round(start));
  ui[`${layer}End`].value = String(Math.round(end));
  anyControlChanged();
}

function installTimelineDragging(layer) {
  const track = document.querySelector(`[data-track="${layer}"]`);
  const bar = document.querySelector(`[data-bar="${layer}"]`);
  const startHandle = document.querySelector(`[data-handle="${layer}-start"]`);
  const endHandle = document.querySelector(`[data-handle="${layer}-end"]`);

  const pctFromEvent = (event) => {
    const rect = track.getBoundingClientRect();
    return clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
  };

  const beginDrag = (event, mode) => {
    event.preventDefault();
    const initialStart = Number(ui[`${layer}Start`].value);
    const initialEnd = Number(ui[`${layer}End`].value);
    const initialPct = pctFromEvent(event);
    bar.classList.add('dragging');
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const move = (moveEvent) => {
      const currentPct = pctFromEvent(moveEvent);
      if (mode === 'start') setTiming(layer, Math.min(currentPct, initialEnd - 1), initialEnd);
      else if (mode === 'end') setTiming(layer, initialStart, Math.max(currentPct, initialStart + 1));
      else {
        const width = initialEnd - initialStart;
        const delta = currentPct - initialPct;
        let nextStart = initialStart + delta;
        nextStart = clamp(nextStart, 0, 100 - width);
        setTiming(layer, nextStart, nextStart + width);
      }
    };

    const end = () => {
      bar.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  startHandle.addEventListener('pointerdown', (event) => beginDrag(event, 'start'));
  endHandle.addEventListener('pointerdown', (event) => beginDrag(event, 'end'));
  bar.addEventListener('pointerdown', (event) => {
    if (event.target === startHandle || event.target === endHandle) return;
    beginDrag(event, 'move');
  });

  track.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 5 : 1;
    const start = Number(ui[`${layer}Start`].value);
    const end = Number(ui[`${layer}End`].value);
    if (event.key === 'ArrowLeft') { event.preventDefault(); setTiming(layer, start - step, end - step); }
    if (event.key === 'ArrowRight') { event.preventDefault(); setTiming(layer, start + step, end + step); }
  });
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
  ui.headline, ui.bgColor, ui.logoSize, ui.marginX, ui.marginY, ui.showMargins,
  ui.duration, ui.fps, ui.logoStart, ui.logoEnd, ui.textStart, ui.textEnd,
  ui.logoY, ui.logoScale, ui.textY, ui.textScale
].forEach((el) => el.addEventListener('input', anyControlChanged));

ui.loadFontBtn.addEventListener('click', loadGoogleFont);
ui.fontFamily.addEventListener('change', loadGoogleFont);
ui.fontFamily.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); loadGoogleFont(); }
});

ui.logoFile.addEventListener('change', () => {
  const file = ui.logoFile.files?.[0];
  if (logoObjectUrl) URL.revokeObjectURL(logoObjectUrl);
  logoObjectUrl = null;
  if (!file) { logoImage = null; renderFrame(playhead); return; }
  logoObjectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    logoImage = image;
    renderFrame(playhead);
    ui.status.textContent = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg') ? 'SVG logo loaded.' : 'Logo loaded.';
  };
  image.onerror = () => {
    ui.status.textContent = 'Could not read that logo. PNG, JPG, WebP and SVG are supported.';
  };
  image.src = logoObjectUrl;
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
    await document.fonts.ready;
    for (let i = 0; i < totalFrames; i++) {
      const t = totalFrames === 1 ? 1 : i / (totalFrames - 1);
      renderFrame(t, exportCtx, exportCanvas.width, exportCanvas.height, { exporting: true });
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
installTimelineDragging('logo');
installTimelineDragging('text');
updateCurveViz();
updateTimingVisuals();
syncTimeline();
document.fonts.ready.then(() => renderFrame(playhead));
