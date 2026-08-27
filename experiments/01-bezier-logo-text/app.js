const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const LOGOS = {
  wordmark: './assets/logos/wordmark.svg',
  combination: './assets/logos/combination.svg',
  stacked: './assets/logos/stacked.svg',
  lettermark: './assets/logos/lettermark.svg',
};

const CANVAS_PRESETS = {
  '1:1': [1080, 1080],
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '4:3': [1200, 900],
  banner: [1200, 400],
  compact: [600, 300],
};

const defaults = {
  headline: 'MORGEN MACHT MAN HEUTE.', fontFamily: 'Anton', fontSize: 52, fontWeight: 400,
  letterSpacing: 2, wordSpacing: 0, textTransform: 'uppercase', textColor: '#ffffff', autoFit: true,
  position: 'below', gap: 28, alignment: 'center', offsetX: 0, offsetY: 0,
  logoType: 'wordmark', logoSize: 220, logoColor: '#ffffff',
  flowMode: 'in-out', enterDuration: 850, holdDuration: 1400, exitDuration: 750,
  enterDirection: 'from-bottom', exitDirection: 'to-top', logoTravel: 50, textTravel: 50,
  logoScale: 0.94, textScale: 0.96, wordStagger: 65,
  enterBezier: [0.05, 0.9, 0.1, 1], exitBezier: [0.7, 0, 0.84, 0],
  logoStart: 0, logoEnd: 100, textStart: 8, textEnd: 100,
  canvasWidth: 800, canvasHeight: 450, bgColor: '#103e36', marginX: 60, marginY: 40,
  showMargins: true, showGrid: false, fps: 30, exportScale: 1,
};

const ui = Object.fromEntries([
  'headline','fontFamily','loadFontBtn','fontStatus','googleFontStylesheet','fontSize','fontWeight','letterSpacing','wordSpacing','textTransform','textColor','autoFit',
  'position','gap','alignment','offsetX','offsetY','logoType','logoFile','logoSize','logoColor','flowMode','enterDuration','holdDuration','exitDuration',
  'enterDirection','exitDirection','logoTravel','textTravel','logoScale','textScale','wordStagger','wordStaggerOut','curveTarget','preset','x1','y1','x2','y2',
  'canvasPreset','canvasWidth','canvasHeight','canvasReadout','bgColor','marginX','marginY','showMargins','showGrid','fps','exportScale','exportBtn','pngBtn',
  'exportProgress','status','playBtn','restartBtn','resetBtn','scrubber','timeReadout','timeline','logoStart','logoEnd','textStart','textEnd','logoTimingLabel','textTimingLabel',
  'curvePath','guide1','guide2','handle1','handle2'
].map((id) => [id, $(id)]));

let logoImage = null;
let logoObjectUrl = null;
let customLogo = null;
let logoAspect = 160 / 704;
let playhead = 0;
let isPlaying = false;
let rafId = null;
let playbackStartedAt = 0;
let playbackOffsetMs = 0;
let fontLoadToken = 0;
let logoLoadToken = 0;
let curveState = { enter: [...defaults.enterBezier], exit: [...defaults.exitBezier] };

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const num = (el, fallback) => Number.isFinite(Number(el?.value)) ? Number(el.value) : fallback;

function transformText(text, transform) {
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize') return text.replace(/\b\w/g, (c) => c.toUpperCase());
  return text;
}

function state() {
  const flowMode = ui.flowMode.value;
  const enterDuration = clamp(num(ui.enterDuration, defaults.enterDuration), 50, 5000);
  const holdDuration = clamp(num(ui.holdDuration, defaults.holdDuration), 0, 10000);
  const exitDuration = clamp(num(ui.exitDuration, defaults.exitDuration), 50, 5000);
  const lifecycleDuration = flowMode === 'in-out' ? enterDuration + holdDuration + exitDuration : flowMode === 'in-stay' ? enterDuration + holdDuration : exitDuration;
  return {
    headline: transformText(ui.headline.value || ' ', ui.textTransform.value),
    fontFamily: ui.fontFamily.value.trim() || 'Anton', fontSize: clamp(num(ui.fontSize, 52), 10, 400),
    fontWeight: clamp(num(ui.fontWeight, 400), 100, 900), letterSpacing: num(ui.letterSpacing, 2), wordSpacing: num(ui.wordSpacing, 0),
    textColor: ui.textColor.value, autoFit: ui.autoFit.checked, position: ui.position.value, gap: clamp(num(ui.gap, 28), 0, 400), alignment: ui.alignment.value,
    offsetX: num(ui.offsetX, 0), offsetY: num(ui.offsetY, 0), logoType: ui.logoType.value, logoSize: clamp(num(ui.logoSize, 220), 20, 1400), logoColor: ui.logoColor.value,
    flowMode, enterDuration, holdDuration, exitDuration, lifecycleDuration,
    enterDirection: ui.enterDirection.value, exitDirection: ui.exitDirection.value,
    logoTravel: clamp(num(ui.logoTravel, 50), 0, 800), textTravel: clamp(num(ui.textTravel, 50), 0, 800),
    logoScale: clamp(num(ui.logoScale, .94), 0, 3), textScale: clamp(num(ui.textScale, .96), 0, 3), wordStagger: clamp(num(ui.wordStagger, 65), 0, 200),
    enterBezier: [...curveState.enter], exitBezier: [...curveState.exit],
    logoStart: clamp(num(ui.logoStart, 0) / 100, 0, .99), logoEnd: clamp(num(ui.logoEnd, 100) / 100, .01, 1),
    textStart: clamp(num(ui.textStart, 8) / 100, 0, .99), textEnd: clamp(num(ui.textEnd, 100) / 100, .01, 1),
    canvasWidth: clamp(Math.round(num(ui.canvasWidth, 800)), 120, 4096), canvasHeight: clamp(Math.round(num(ui.canvasHeight, 450)), 120, 4096),
    bgColor: ui.bgColor.value, marginX: clamp(num(ui.marginX, 60), 0, 1200), marginY: clamp(num(ui.marginY, 40), 0, 1200),
    showMargins: ui.showMargins.checked, showGrid: ui.showGrid.checked, fps: clamp(Math.round(num(ui.fps, 30)), 8, 60), exportScale: clamp(num(ui.exportScale, 1), .5, 2),
  };
}

function normalizeRanges(s) {
  if (s.logoEnd <= s.logoStart + .01) s.logoEnd = Math.min(1, s.logoStart + .01);
  if (s.textEnd <= s.textStart + .01) s.textEnd = Math.min(1, s.textStart + .01);
  return s;
}

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
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const current = bezierCoord(t, x1, x2);
    if (Math.abs(current - x) < 1e-6) break;
    if (current < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return bezierCoord(t, y1, y2);
}

function rangeProgress(t, start, end) {
  if (end <= start) return t >= end ? 1 : 0;
  return clamp((t - start) / (end - start), 0, 1);
}

function lifecycleState(localT, s, travel, startScale, wordIndex = 0, wordCount = 1) {
  const enterDir = s.enterDirection === 'from-top' ? -1 : 1;
  const exitDir = s.exitDirection === 'to-bottom' ? 1 : -1;
  if (s.flowMode === 'out') {
    const p = cubicBezierEase(localT, ...s.exitBezier);
    return { alpha: 1 - p, y: exitDir * travel * p, scale: 1 };
  }
  const total = s.flowMode === 'in-out' ? s.enterDuration + s.holdDuration + s.exitDuration : s.enterDuration + s.holdDuration;
  const stagger = wordCount > 1 ? (wordIndex * s.wordStagger) : 0;
  const enterEnd = (s.enterDuration + stagger) / total;
  const enterStart = stagger / total;
  if (localT < enterEnd) {
    const raw = clamp((localT - enterStart) / Math.max(.0001, enterEnd - enterStart), 0, 1);
    const p = cubicBezierEase(raw, ...s.enterBezier);
    return { alpha: p, y: enterDir * travel * (1 - p), scale: lerp(startScale, 1, p) };
  }
  if (s.flowMode === 'in-stay') return { alpha: 1, y: 0, scale: 1 };
  const exitStart = (s.enterDuration + s.holdDuration) / total;
  if (localT <= exitStart) return { alpha: 1, y: 0, scale: 1 };
  const raw = clamp((localT - exitStart) / Math.max(.0001, 1 - exitStart), 0, 1);
  const p = cubicBezierEase(raw, ...s.exitBezier);
  return { alpha: 1 - p, y: exitDir * travel * p, scale: 1 };
}

function fontString(s) { return `${s.fontWeight} ${s.fontSize}px "${s.fontFamily.replace(/"/g, '')}", sans-serif`; }
function measureSpacedText(context, text, s) {
  context.font = fontString(s);
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    width += context.measureText(ch).width;
    if (i < text.length - 1) width += ch === ' ' ? s.wordSpacing + s.letterSpacing : s.letterSpacing;
  }
  return width;
}
function drawWord(context, word, x, baselineY, s) {
  let cursor = x;
  context.font = fontString(s);
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    context.fillText(ch, cursor, baselineY);
    cursor += context.measureText(ch).width + (i < word.length - 1 ? s.letterSpacing : 0);
  }
}

function resolvedTextState(context, s, width) {
  if (!s.autoFit) return s;
  const logo = logoDimensions(s);
  const marginWidth = Math.max(40, width - Math.min(s.marginX, width / 2 - 1) * 2);
  const maxTextWidth = (s.position === 'left' || s.position === 'right') ? Math.max(40, marginWidth - logo.w - s.gap) : marginWidth;
  let size = s.fontSize;
  let candidate = { ...s, fontSize: size };
  while (size > 10 && measureSpacedText(context, candidate.headline, candidate) > maxTextWidth) {
    size -= 1;
    candidate = { ...s, fontSize: size };
  }
  return candidate;
}

function textWordLayout(context, text, s) {
  const words = text.split(/\s+/).filter(Boolean);
  const widths = words.map((w) => measureSpacedText(context, w, { ...s, wordSpacing: 0 }));
  context.font = fontString(s);
  const space = context.measureText(' ').width + s.wordSpacing + s.letterSpacing;
  const totalWidth = widths.reduce((a, b) => a + b, 0) + Math.max(0, words.length - 1) * space;
  return { words, widths, space, totalWidth };
}

function logoDimensions(s) {
  return { w: s.logoSize, h: s.logoSize * (Number.isFinite(logoAspect) && logoAspect > 0 ? logoAspect : .28) };
}

function aspectFromSvg(svgText) {
  const match = svgText.match(/viewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)["']/i);
  if (!match) return null;
  const w = Number(match[1]), h = Number(match[2]);
  return w > 0 && h > 0 ? h / w : null;
}

function lockupLayout(context, s, width, height) {
  const logo = logoDimensions(s);
  const textW = measureSpacedText(context, s.headline, s);
  const textH = s.fontSize * 1.05;
  const cx = width / 2 + s.offsetX, cy = height / 2 + s.offsetY;
  let logoX = cx, logoY = cy, textX = cx, textY = cy;
  if (s.position === 'below' || s.position === 'above') {
    const blockW = Math.max(logo.w, textW);
    const blockH = logo.h + s.gap + textH;
    const left = cx - blockW / 2;
    const alignX = (itemW) => s.alignment === 'start' ? left + itemW / 2 : s.alignment === 'end' ? left + blockW - itemW / 2 : cx;
    if (s.position === 'below') {
      const top = cy - blockH / 2;
      logoX = alignX(logo.w); logoY = top + logo.h / 2;
      textX = alignX(textW); textY = top + logo.h + s.gap + textH / 2;
    } else {
      const top = cy - blockH / 2;
      textX = alignX(textW); textY = top + textH / 2;
      logoX = alignX(logo.w); logoY = top + textH + s.gap + logo.h / 2;
    }
  } else {
    const blockW = logo.w + s.gap + textW;
    const left = cx - blockW / 2;
    if (s.position === 'right') {
      logoX = left + logo.w / 2; textX = left + logo.w + s.gap + textW / 2;
    } else {
      textX = left + textW / 2; logoX = left + textW + s.gap + logo.w / 2;
    }
  }
  return { logoX, logoY, textX, textY, logoW: logo.w, logoH: logo.h, textW, textH };
}

function drawGuides(context, s, width, height) {
  context.save();
  if (s.showGrid) {
    context.strokeStyle = 'rgba(255,255,255,.14)'; context.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = width * i / 4, y = height * i / 4;
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
  }
  if (s.showMargins) {
    const mx = Math.min(s.marginX, width / 2 - 1), my = Math.min(s.marginY, height / 2 - 1);
    context.strokeStyle = 'rgba(255,255,255,.48)'; context.lineWidth = 1; context.setLineDash([6, 6]);
    context.strokeRect(mx, my, Math.max(1, width - mx * 2), Math.max(1, height - my * 2));
    context.setLineDash([]);
  }
  context.restore();
}

function renderFrame(t, targetCtx = ctx, width = canvas.width, height = canvas.height, options = {}) {
  const s = normalizeRanges(state());
  const scaleX = width / s.canvasWidth, scaleY = height / s.canvasHeight;
  targetCtx.save();
  targetCtx.clearRect(0, 0, width, height);
  targetCtx.scale(scaleX, scaleY);
  const baseW = s.canvasWidth, baseH = s.canvasHeight;
  if (!options.transparent) {
    targetCtx.fillStyle = s.bgColor; targetCtx.fillRect(0, 0, baseW, baseH);
  }
  const textState = resolvedTextState(targetCtx, s, baseW);
  const layout = lockupLayout(targetCtx, textState, baseW, baseH);
  const logoT = rangeProgress(t, s.logoStart, s.logoEnd);
  const textT = rangeProgress(t, s.textStart, s.textEnd);
  const logoMotion = lifecycleState(logoT, s, s.logoTravel, s.logoScale);
  if (logoImage && logoMotion.alpha > .001) {
    targetCtx.save(); targetCtx.globalAlpha = clamp(logoMotion.alpha, 0, 1);
    targetCtx.translate(layout.logoX, layout.logoY + logoMotion.y); targetCtx.scale(logoMotion.scale, logoMotion.scale);
    targetCtx.drawImage(logoImage, -layout.logoW / 2, -layout.logoH / 2, layout.logoW, layout.logoH); targetCtx.restore();
  }
  const words = textWordLayout(targetCtx, textState.headline, textState);
  let wordX = layout.textX - words.totalWidth / 2;
  words.words.forEach((word, i) => {
    const motion = lifecycleState(textT, s, s.textTravel, s.textScale, i, words.words.length);
    targetCtx.save(); targetCtx.globalAlpha = clamp(motion.alpha, 0, 1); targetCtx.fillStyle = textState.textColor;
    const center = wordX + words.widths[i] / 2;
    targetCtx.translate(center, layout.textY + motion.y); targetCtx.scale(motion.scale, motion.scale); targetCtx.translate(-center, -(layout.textY + motion.y));
    drawWord(targetCtx, word, wordX, layout.textY + motion.y, textState); targetCtx.restore();
    wordX += words.widths[i] + words.space;
  });
  if (!options.hideGuides) drawGuides(targetCtx, s, baseW, baseH);
  targetCtx.restore();
}

function totalDurationMs(s = state()) { return Math.max(50, s.lifecycleDuration); }
function syncPlayhead() {
  const s = state();
  ui.scrubber.value = String(playhead);
  ui.timeReadout.value = `${(playhead * totalDurationMs(s) / 1000).toFixed(2)} s`;
  renderFrame(playhead);
  updateTimelinePlayhead();
}
function tick(now) {
  if (!isPlaying) return;
  const elapsed = now - playbackStartedAt + playbackOffsetMs;
  playhead = clamp(elapsed / totalDurationMs(), 0, 1);
  syncPlayhead();
  if (playhead >= 1) { isPlaying = false; ui.playBtn.textContent = 'Play'; rafId = null; return; }
  rafId = requestAnimationFrame(tick);
}
function play() {
  if (isPlaying) {
    isPlaying = false; ui.playBtn.textContent = 'Play'; if (rafId) cancelAnimationFrame(rafId); rafId = null; playbackOffsetMs = playhead * totalDurationMs(); return;
  }
  if (playhead >= 1) playhead = 0;
  playbackOffsetMs = playhead * totalDurationMs(); playbackStartedAt = performance.now(); isPlaying = true; ui.playBtn.textContent = 'Pause'; rafId = requestAnimationFrame(tick);
}
function restart() {
  isPlaying = false; if (rafId) cancelAnimationFrame(rafId); rafId = null; playhead = 0; playbackOffsetMs = 0; ui.playBtn.textContent = 'Play'; syncPlayhead();
}

async function loadGoogleFont() {
  const family = ui.fontFamily.value.trim() || 'Anton';
  const token = ++fontLoadToken;
  ui.fontStatus.textContent = `Loading ${family}…`;
  ui.googleFontStylesheet.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`;
  try {
    if (document.fonts) { await document.fonts.load(`${ui.fontWeight.value || 400} 48px "${family}"`); await document.fonts.ready; }
    if (token !== fontLoadToken) return;
    ui.fontStatus.textContent = `${family} loaded from Google Fonts.`; renderFrame(playhead);
  } catch {
    if (token !== fontLoadToken) return;
    ui.fontStatus.textContent = `Could not confirm ${family}; browser fallback may be shown.`; renderFrame(playhead);
  }
}

function colorizeSvg(svgText, color) {
  const style = `<style>path,rect,circle,polygon,ellipse{fill:${color} !important;}</style>`;
  return svgText.replace(/<svg([^>]*)>/i, (m) => `${m}${style}`);
}
async function loadBuiltInLogo(type = ui.logoType.value) {
  if (type === 'custom') { if (customLogo) logoImage = customLogo; renderFrame(playhead); return; }
  const path = LOGOS[type] || LOGOS.wordmark;
  const token = ++logoLoadToken;
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const sourceSvg = await response.text();
    const parsedAspect = aspectFromSvg(sourceSvg);
    const svg = colorizeSvg(sourceSvg, ui.logoColor.value);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    if (token !== logoLoadToken) { URL.revokeObjectURL(url); return; }
    if (logoObjectUrl) URL.revokeObjectURL(logoObjectUrl);
    logoObjectUrl = url; logoImage = image; logoAspect = parsedAspect || ((image.naturalHeight || image.height || 1) / (image.naturalWidth || image.width || 1)); renderFrame(playhead);
  } catch (error) {
    ui.status.textContent = `Logo load failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function applyCanvasPreset() {
  const preset = CANVAS_PRESETS[ui.canvasPreset.value];
  if (!preset) return;
  ui.canvasWidth.value = preset[0]; ui.canvasHeight.value = preset[1]; applyCanvasSize();
}
function applyCanvasSize() {
  const s = state();
  canvas.width = s.canvasWidth; canvas.height = s.canvasHeight;
  ui.canvasReadout.textContent = `${s.canvasWidth} × ${s.canvasHeight}`;
  renderFrame(playhead);
}

function setCurveInputs(target) {
  const c = curveState[target];
  [ui.x1.value, ui.y1.value, ui.x2.value, ui.y2.value] = c.map(String);
  const presetValue = c.join(',');
  ui.preset.value = [...ui.preset.options].some((o) => o.value === presetValue) ? presetValue : 'custom';
  updateCurveViz();
}
function updateCurveFromInputs() {
  curveState[ui.curveTarget.value] = [clamp(num(ui.x1, .05), 0, 1), num(ui.y1, .9), clamp(num(ui.x2, .1), 0, 1), num(ui.y2, 1)];
  ui.preset.value = 'custom'; updateCurveViz(); renderFrame(playhead);
}
function updateCurveViz() {
  const [x1, y1, x2, y2] = curveState[ui.curveTarget.value];
  const left = 20, right = 240, top = 20, bottom = 150;
  const sx = (x) => left + x * (right - left), sy = (y) => bottom - ((y + .25) / 1.5) * (bottom - top);
  const start = [sx(0), sy(0)], p1 = [sx(x1), sy(y1)], p2 = [sx(x2), sy(y2)], end = [sx(1), sy(1)];
  ui.curvePath.setAttribute('d', `M${start[0]} ${start[1]} C${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]} ${end[0]} ${end[1]}`);
  ui.guide1.setAttribute('d', `M${start[0]} ${start[1]} L${p1[0]} ${p1[1]}`); ui.guide2.setAttribute('d', `M${end[0]} ${end[1]} L${p2[0]} ${p2[1]}`);
  ui.handle1.setAttribute('cx', p1[0]); ui.handle1.setAttribute('cy', p1[1]); ui.handle2.setAttribute('cx', p2[0]); ui.handle2.setAttribute('cy', p2[1]);
}

function lifecycleFractions() {
  const s = state();
  if (s.flowMode === 'out') return [0, 0, 1];
  const total = Math.max(1, s.flowMode === 'in-out' ? s.enterDuration + s.holdDuration + s.exitDuration : s.enterDuration + s.holdDuration);
  return s.flowMode === 'in-out' ? [s.enterDuration / total, s.holdDuration / total, s.exitDuration / total] : [s.enterDuration / total, s.holdDuration / total, 0];
}
function updateTimeline() {
  const ranges = { logo: [num(ui.logoStart, 0), num(ui.logoEnd, 100)], text: [num(ui.textStart, 8), num(ui.textEnd, 100)] };
  const phases = lifecycleFractions();
  Object.entries(ranges).forEach(([layer, [startRaw, endRaw]]) => {
    let start = clamp(startRaw, 0, 99), end = clamp(endRaw, 1, 100); if (end <= start) end = Math.min(100, start + 1);
    const bar = ui.timeline.querySelector(`[data-bar="${layer}"]`); bar.style.left = `${start}%`; bar.style.width = `${end - start}%`;
    const ps = bar.querySelectorAll('.phase'); ps[0].style.width = `${phases[0] * 100}%`; ps[1].style.width = `${phases[1] * 100}%`; ps[2].style.width = `${phases[2] * 100}%`;
    ui[`${layer}TimingLabel`].textContent = `${Math.round(start)}–${Math.round(end)}%`;
  });
  updateTimelinePlayhead();
}
function updateTimelinePlayhead() {
  const firstTrack = ui.timeline.querySelector('.timing-track'); const line = ui.timeline.querySelector('.timeline-playhead'); if (!firstTrack || !line) return;
  const timelineRect = ui.timeline.getBoundingClientRect(), trackRect = firstTrack.getBoundingClientRect();
  line.style.left = `${trackRect.left - timelineRect.left + trackRect.width * playhead}px`;
}

function setupTimelineDrag() {
  let drag = null;
  ui.timeline.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('.timing-handle'); const bar = event.target.closest('.timing-bar'); if (!bar) return;
    const layer = bar.dataset.bar, track = ui.timeline.querySelector(`[data-track="${layer}"]`), rect = track.getBoundingClientRect();
    const startEl = ui[`${layer}Start`], endEl = ui[`${layer}End`];
    drag = { layer, kind: handle ? (handle.classList.contains('start') ? 'start' : 'end') : 'bar', rect, x0: event.clientX, start0: num(startEl, 0), end0: num(endEl, 100), startEl, endEl };
    bar.setPointerCapture(event.pointerId); event.preventDefault();
  });
  ui.timeline.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const delta = (event.clientX - drag.x0) / Math.max(1, drag.rect.width) * 100;
    let start = drag.start0, end = drag.end0;
    if (drag.kind === 'start') start = clamp(drag.start0 + delta, 0, end - 1);
    else if (drag.kind === 'end') end = clamp(drag.end0 + delta, start + 1, 100);
    else { const len = drag.end0 - drag.start0; start = clamp(drag.start0 + delta, 0, 100 - len); end = start + len; }
    drag.startEl.value = Math.round(start); drag.endEl.value = Math.round(end); updateTimeline(); renderFrame(playhead);
  });
  const stop = () => { drag = null; };
  ui.timeline.addEventListener('pointerup', stop); ui.timeline.addEventListener('pointercancel', stop);
}

function generalChanged() { ui.wordStaggerOut.value = `${Math.round(num(ui.wordStagger, 65))} ms`; updateTimeline(); renderFrame(playhead); }

function resetDefaults() {
  for (const [key, value] of Object.entries(defaults)) {
    if (!ui[key]) continue;
    if (typeof value === 'boolean') ui[key].checked = value; else if (!Array.isArray(value)) ui[key].value = String(value);
  }
  curveState = { enter: [...defaults.enterBezier], exit: [...defaults.exitBezier] };
  ui.canvasPreset.value = 'custom'; ui.logoType.value = 'wordmark'; customLogo = null; ui.logoFile.value = '';
  setCurveInputs('enter'); applyCanvasSize(); loadGoogleFont(); loadBuiltInLogo('wordmark'); restart(); updateTimeline();
}

async function exportGif() {
  const s = state();
  const totalFrames = Math.max(2, Math.min(240, Math.round(totalDurationMs(s) / 1000 * s.fps)));
  const delay = Math.round(1000 / s.fps), scale = s.exportScale;
  ui.exportBtn.disabled = true; ui.exportProgress.value = 0; ui.status.textContent = 'Loading GIF encoder…';
  try {
    const { GIFEncoder, quantize, applyPalette } = await import('https://unpkg.com/gifenc@1.0.3?module');
    const exportCanvas = document.createElement('canvas'); exportCanvas.width = Math.round(s.canvasWidth * scale); exportCanvas.height = Math.round(s.canvasHeight * scale);
    const exportCtx = exportCanvas.getContext('2d', { willReadFrequently: true }); const gif = GIFEncoder();
    for (let i = 0; i < totalFrames; i++) {
      const t = i / (totalFrames - 1); renderFrame(t, exportCtx, exportCanvas.width, exportCanvas.height, { hideGuides: true });
      const rgba = exportCtx.getImageData(0, 0, exportCanvas.width, exportCanvas.height).data;
      const palette = quantize(rgba, 256, { format: 'rgb565' }); const indexed = applyPalette(rgba, palette, 'rgb565');
      gif.writeFrame(indexed, exportCanvas.width, exportCanvas.height, { palette, delay, repeat: 0 });
      ui.exportProgress.value = (i + 1) / totalFrames; ui.status.textContent = `Encoding ${i + 1} / ${totalFrames}…`;
      if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    gif.finish(); const blob = new Blob([gif.bytes()], { type: 'image/gif' }); downloadBlob(blob, `anim-${s.canvasWidth}x${s.canvasHeight}.gif`);
    ui.status.textContent = `Done — ${(blob.size / 1024 / 1024).toFixed(1)} MB GIF.`;
  } catch (error) { console.error(error); ui.status.textContent = `Export failed: ${error instanceof Error ? error.message : String(error)}`; }
  finally { ui.exportBtn.disabled = false; }
}
function downloadBlob(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1200); }
function exportPng() {
  const s = state(), scale = s.exportScale, out = document.createElement('canvas'); out.width = Math.round(s.canvasWidth * scale); out.height = Math.round(s.canvasHeight * scale);
  const outCtx = out.getContext('2d'); renderFrame(playhead, outCtx, out.width, out.height, { hideGuides: true });
  out.toBlob((blob) => { if (blob) downloadBlob(blob, `anim-frame-${s.canvasWidth}x${s.canvasHeight}.png`); }, 'image/png');
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === tab));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab.dataset.tab));
  }));
}

ui.playBtn.addEventListener('click', play); ui.restartBtn.addEventListener('click', restart); ui.resetBtn.addEventListener('click', resetDefaults);
ui.scrubber.addEventListener('input', () => { isPlaying = false; if (rafId) cancelAnimationFrame(rafId); rafId = null; ui.playBtn.textContent = 'Play'; playhead = clamp(Number(ui.scrubber.value), 0, 1); playbackOffsetMs = playhead * totalDurationMs(); syncPlayhead(); });
ui.loadFontBtn.addEventListener('click', loadGoogleFont); ui.fontFamily.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadGoogleFont(); });
ui.fontWeight.addEventListener('change', loadGoogleFont);
ui.logoType.addEventListener('change', () => loadBuiltInLogo(ui.logoType.value)); ui.logoColor.addEventListener('input', () => { if (ui.logoType.value !== 'custom') loadBuiltInLogo(ui.logoType.value); });
ui.logoFile.addEventListener('change', async () => {
  const file = ui.logoFile.files?.[0]; if (!file) return;
  let uploadedAspect = null;
  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
    try { uploadedAspect = aspectFromSvg(await file.text()); } catch { uploadedAspect = null; }
  }
  const url = URL.createObjectURL(file), image = new Image(); image.onload = () => { customLogo = image; logoImage = image; logoAspect = uploadedAspect || ((image.naturalHeight || image.height || 1) / (image.naturalWidth || image.width || 1)); ui.logoType.value = 'custom'; if (logoObjectUrl) URL.revokeObjectURL(logoObjectUrl); logoObjectUrl = url; renderFrame(playhead); }; image.onerror = () => { URL.revokeObjectURL(url); ui.status.textContent = 'Could not read that logo file.'; }; image.src = url;
});
ui.canvasPreset.addEventListener('change', applyCanvasPreset); [ui.canvasWidth, ui.canvasHeight].forEach((el) => el.addEventListener('change', () => { ui.canvasPreset.value = 'custom'; applyCanvasSize(); }));
ui.curveTarget.addEventListener('change', () => setCurveInputs(ui.curveTarget.value)); ui.preset.addEventListener('change', () => { if (ui.preset.value === 'custom') return; curveState[ui.curveTarget.value] = ui.preset.value.split(',').map(Number); setCurveInputs(ui.curveTarget.value); renderFrame(playhead); });
[ui.x1, ui.y1, ui.x2, ui.y2].forEach((el) => el.addEventListener('input', updateCurveFromInputs));
[ui.logoStart, ui.logoEnd, ui.textStart, ui.textEnd].forEach((el) => el.addEventListener('input', generalChanged));
[ui.headline,ui.fontSize,ui.letterSpacing,ui.wordSpacing,ui.textTransform,ui.textColor,ui.autoFit,ui.position,ui.gap,ui.alignment,ui.offsetX,ui.offsetY,ui.logoSize,ui.flowMode,ui.enterDuration,ui.holdDuration,ui.exitDuration,ui.enterDirection,ui.exitDirection,ui.logoTravel,ui.textTravel,ui.logoScale,ui.textScale,ui.wordStagger,ui.bgColor,ui.marginX,ui.marginY,ui.showMargins,ui.showGrid,ui.fps,ui.exportScale].forEach((el) => el.addEventListener('input', generalChanged));
ui.exportBtn.addEventListener('click', exportGif); ui.pngBtn.addEventListener('click', exportPng); window.addEventListener('resize', updateTimelinePlayhead);
window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) { e.preventDefault(); restart(); play(); } });

async function initialize() {
  setupTabs(); setupTimelineDrag(); setCurveInputs('enter'); applyCanvasSize(); updateTimeline();
  await loadBuiltInLogo('wordmark');
  loadGoogleFont(); syncPlayhead();
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setTimeout(play, 120);
}
initialize();
