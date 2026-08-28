const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const STORAGE_KEY = 'anim-studio:experiment-01:v4';
const LOGOS = {
  wordmark: './assets/logos/wordmark.svg',
  combination: './assets/logos/combination.svg',
  stacked: './assets/logos/stacked.svg',
  lettermark: './assets/logos/lettermark.svg',
};
const CANVAS_PRESETS = {
  '1:1': [1080, 1080], '16:9': [1920, 1080], '9:16': [1080, 1920], '4:5': [1080, 1350], '4:3': [1200, 900], banner: [1200, 400],
};
const CURVE_PRESETS = {
  fast: [0.22, 1, 0.36, 1],
  expo: [0.16, 1, 0.3, 1],
  smooth: [0.65, 0, 0.35, 1],
  back: [0.34, 1.56, 0.64, 1],
  snappy: [0.05, 0.9, 0.1, 1],
};
const MOTION_PRESETS = {
  smooth: { enter: 700, hold: 600, exit: 650, travel: 40, scale: 0.96, stagger: 25, enterBezier: CURVE_PRESETS.fast, exitBezier: CURVE_PRESETS.smooth },
  snappy: { enter: 450, hold: 250, exit: 400, travel: 65, scale: 0.9, stagger: 20, enterBezier: CURVE_PRESETS.expo, exitBezier: CURVE_PRESETS.smooth },
  soft: { enter: 950, hold: 800, exit: 850, travel: 28, scale: 0.98, stagger: 40, enterBezier: CURVE_PRESETS.fast, exitBezier: CURVE_PRESETS.smooth },
  pop: { enter: 600, hold: 450, exit: 550, travel: 32, scale: 0.84, stagger: 28, enterBezier: CURVE_PRESETS.back, exitBezier: CURVE_PRESETS.fast },
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;

const DEFAULT_MODEL = {
  headline: 'MORGEN MACHT MAN HEUTE.',
  fontFamily: 'Anton', fontSize: 52, fontWeight: 400, letterSpacing: 2, wordSpacing: 0, textAlign: 'center', textTransform: 'uppercase', textColor: '#ffffff', autoFit: true,
  position: 'below', gap: 28, alignment: 'center', verticalAlignment: 'center', offsetX: 0, offsetY: 0, logoOffsetX: 0, logoOffsetY: 0, textOffsetX: 0, textOffsetY: 0,
  logoType: 'wordmark', logoSize: 220, logoColor: '#ffffff',
  canvasWidth: 800, canvasHeight: 450, bgColor: '#103e36', marginX: 60, marginY: 40, showMargins: true, showGrid: false,
  fps: 30, exportScale: 1, gifColors: 256, gifLoop: true,
  playbackRate: 1, previewLoop: true, viewportZoom: 'fit', snap: true,
  layers: {
    logo: { start: 0, mode: 'in-hold-out', enter: 850, hold: 350, exit: 750, enterDirection: 'from-bottom', exitDirection: 'to-top', travel: 50, scale: 0.94, stagger: 0, enterBezier: [0.05, 0.9, 0.1, 1], exitBezier: [0.85, 0, 1, 0.2] },
    text: { start: 120, mode: 'in-hold-out', enter: 850, hold: 350, exit: 750, enterDirection: 'from-bottom', exitDirection: 'to-top', travel: 50, scale: 0.96, stagger: 35, enterBezier: [0.05, 0.9, 0.1, 1], exitBezier: [0.85, 0, 1, 0.2] },
  },
};

let model = clone(DEFAULT_MODEL);
let selectedLayer = 'logo';
let selectedCurve = 'enter';
let customLogo = null;
let logoImage = null;
let logoAspect = 160 / 704;
let logoObjectUrl = null;
let fontToken = 0;
let logoToken = 0;
let playhead = 0;
let isPlaying = false;
let rafId = null;
let playbackStartedAt = 0;
let playbackOffsetMs = 0;
let activeDrag = null;
let history = [JSON.stringify(model)];
let historyIndex = 0;
let saveTimer = null;
let restoring = false;

function layerDuration(layer) {
  const l = model.layers[layer];
  if (l.mode === 'static') return Math.max(250, l.hold || 1000);
  if (l.mode === 'in-only') return Math.max(50, l.enter);
  if (l.mode === 'out-only') return Math.max(50, l.exit);
  if (l.mode === 'in-out') return Math.max(100, l.enter + l.exit);
  if (l.mode === 'in-stay') return Math.max(50, l.enter + l.hold);
  return Math.max(100, l.enter + l.hold + l.exit);
}
function layerEnd(layer) { return model.layers[layer].start + layerDuration(layer); }
function durationMs() { return Math.max(500, layerEnd('logo'), layerEnd('text')); }
function phaseDurations(layer) {
  const l = model.layers[layer];
  if (l.mode === 'static') return [0, layerDuration(layer), 0];
  if (l.mode === 'in-only') return [layerDuration(layer), 0, 0];
  if (l.mode === 'out-only') return [0, 0, layerDuration(layer)];
  if (l.mode === 'in-out') return [l.enter, 0, l.exit];
  if (l.mode === 'in-stay') return [l.enter, l.hold, 0];
  return [l.enter, l.hold, l.exit];
}
function transformText(text) {
  if (model.textTransform === 'uppercase') return text.toUpperCase();
  if (model.textTransform === 'lowercase') return text.toLowerCase();
  if (model.textTransform === 'capitalize') return text.replace(/\b\w/g, (c) => c.toUpperCase());
  return text;
}

function snapshot() { return JSON.stringify(model); }
function commitHistory() {
  if (restoring) return;
  const s = snapshot();
  if (history[historyIndex] === s) return;
  history = history.slice(0, historyIndex + 1);
  history.push(s);
  if (history.length > 80) history.shift();
  historyIndex = history.length - 1;
  syncHistoryButtons();
  scheduleSave();
}
function restoreHistory(index) {
  if (index < 0 || index >= history.length) return;
  historyIndex = index;
  model = JSON.parse(history[index]);
  syncAll({ reloadLogo: true, reloadFont: true });
  syncHistoryButtons();
  scheduleSave();
}
function undo() { restoreHistory(historyIndex - 1); }
function redo() { restoreHistory(historyIndex + 1); }
function syncHistoryButtons() { $('undoBtn').disabled = historyIndex <= 0; $('redoBtn').disabled = historyIndex >= history.length - 1; }

function scheduleSave() {
  if (restoring) return;
  const status = $('saveStatus');
  status.innerHTML = '<i></i>Saving…';
  status.classList.add('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 320);
}
function saveNow() {
  try {
    const safe = clone(model);
    if (safe.logoType === 'custom') safe.logoType = 'wordmark';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    $('saveStatus').innerHTML = '<i></i>Autosaved';
    $('saveStatus').classList.remove('saving');
  } catch {
    $('saveStatus').textContent = 'Save unavailable';
  }
}
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed?.layers?.logo || !parsed?.layers?.text) return false;
    model = { ...clone(DEFAULT_MODEL), ...parsed, layers: { logo: { ...clone(DEFAULT_MODEL.layers.logo), ...parsed.layers.logo }, text: { ...clone(DEFAULT_MODEL.layers.text), ...parsed.layers.text } } };
    return true;
  } catch { return false; }
}

function bezierCoord(t, a1, a2) { const o = 1 - t; return 3 * o * o * t * a1 + 3 * o * t * t * a2 + t * t * t; }
function bezierDerivative(t, a1, a2) { const o = 1 - t; return 3 * o * o * a1 + 6 * o * t * (a2 - a1) + 3 * t * t * (1 - a2); }
function cubicBezierEase(x, x1, y1, x2, y2) {
  x = clamp(x, 0, 1); let t = x;
  for (let i = 0; i < 7; i++) { const err = bezierCoord(t, x1, x2) - x; const slope = bezierDerivative(t, x1, x2); if (Math.abs(err) < 1e-6 || Math.abs(slope) < 1e-6) break; t = clamp(t - err / slope, 0, 1); }
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) { const current = bezierCoord(t, x1, x2); if (Math.abs(current - x) < 1e-6) break; if (current < x) lo = t; else hi = t; t = (lo + hi) / 2; }
  return bezierCoord(t, y1, y2);
}
function directionVector(value) {
  if (value.endsWith('left')) return [-1, 0];
  if (value.endsWith('right')) return [1, 0];
  if (value.endsWith('top')) return [0, -1];
  if (value.endsWith('bottom')) return [0, 1];
  return [0, 0];
}
function motionState(layerName, globalMs, wordIndex = 0, wordCount = 1) {
  const l = model.layers[layerName];
  const localMs = globalMs - l.start;
  if (localMs < 0) return { alpha: 0, x: 0, y: 0, scale: l.scale };
  if (l.mode === 'static') return { alpha: 1, x: 0, y: 0, scale: 1 };
  const enterVec = directionVector(l.enterDirection), exitVec = directionVector(l.exitDirection);
  if (l.mode === 'out-only') {
    const p = cubicBezierEase(clamp(localMs / Math.max(1, l.exit), 0, 1), ...l.exitBezier);
    return { alpha: 1 - p, x: exitVec[0] * l.travel * p, y: exitVec[1] * l.travel * p, scale: 1 };
  }
  const stagger = layerName === 'text' && wordCount > 1 ? wordIndex * l.stagger : 0;
  const enterStart = stagger, enterEnd = enterStart + l.enter;
  if (localMs < enterEnd) {
    const p = cubicBezierEase(clamp((localMs - enterStart) / Math.max(1, l.enter), 0, 1), ...l.enterBezier);
    return { alpha: p, x: enterVec[0] * l.travel * (1 - p), y: enterVec[1] * l.travel * (1 - p), scale: lerp(l.scale, 1, p) };
  }
  if (l.mode === 'in-only' || l.mode === 'in-stay') return { alpha: 1, x: 0, y: 0, scale: 1 };
  const exitStart = l.mode === 'in-out' ? l.enter : l.enter + l.hold;
  if (localMs <= exitStart) return { alpha: 1, x: 0, y: 0, scale: 1 };
  const p = cubicBezierEase(clamp((localMs - exitStart) / Math.max(1, l.exit), 0, 1), ...l.exitBezier);
  return { alpha: 1 - p, x: exitVec[0] * l.travel * p, y: exitVec[1] * l.travel * p, scale: 1 };
}

function fontString(s) { return `${s.fontWeight} ${s.fontSize}px "${s.fontFamily.replace(/"/g, '')}", sans-serif`; }
function measureSpacedText(context, text, s) {
  context.font = fontString(s); let width = 0;
  for (let i = 0; i < text.length; i++) { const ch = text[i]; width += context.measureText(ch).width; if (i < text.length - 1) width += ch === ' ' ? s.wordSpacing + s.letterSpacing : s.letterSpacing; }
  return width;
}
function drawWord(context, word, x, y, s) {
  context.font = fontString(s); context.textAlign = 'left'; context.textBaseline = 'middle'; let cursor = x;
  for (let i = 0; i < word.length; i++) { const ch = word[i]; context.fillText(ch, cursor, y); cursor += context.measureText(ch).width + (i < word.length - 1 ? s.letterSpacing : 0); }
}
function textWordLayout(context, text, s) {
  const words = text.split(/\s+/).filter(Boolean), widths = words.map((w) => measureSpacedText(context, w, { ...s, wordSpacing: 0 }));
  context.font = fontString(s); const space = context.measureText(' ').width + s.wordSpacing + s.letterSpacing;
  return { words, widths, space, totalWidth: widths.reduce((a, b) => a + b, 0) + Math.max(0, words.length - 1) * space };
}
function logoDimensions() { return { w: model.logoSize, h: model.logoSize * (logoAspect > 0 ? logoAspect : .28) }; }
function resolvedTextState(context) {
  const s = { ...model, headline: transformText(model.headline || ' ') };
  if (!model.autoFit) return s;
  const logo = logoDimensions(), safeWidth = Math.max(40, model.canvasWidth - Math.min(model.marginX, model.canvasWidth / 2 - 1) * 2);
  const maxTextWidth = ['left', 'right'].includes(model.position) ? Math.max(40, safeWidth - logo.w - model.gap) : safeWidth;
  let size = model.fontSize, candidate = { ...s, fontSize: size };
  while (size > 10 && measureSpacedText(context, candidate.headline, candidate) > maxTextWidth) { size -= 1; candidate = { ...candidate, fontSize: size }; }
  return candidate;
}
function lockupLayout(context, s) {
  const width = model.canvasWidth, height = model.canvasHeight, logo = logoDimensions();
  const textW = measureSpacedText(context, s.headline, s), textH = s.fontSize * 1.05, cx = width / 2 + model.offsetX, cy = height / 2 + model.offsetY;
  let logoX = cx, logoY = cy, textX = cx, textY = cy;
  if (model.position === 'below' || model.position === 'above') {
    const blockW = Math.max(logo.w, textW), blockH = logo.h + model.gap + textH, left = cx - blockW / 2;
    const alignX = (itemW) => model.alignment === 'start' ? left + itemW / 2 : model.alignment === 'end' ? left + blockW - itemW / 2 : cx;
    const top = cy - blockH / 2;
    if (model.position === 'below') { logoX = alignX(logo.w); logoY = top + logo.h / 2; textX = alignX(textW); textY = top + logo.h + model.gap + textH / 2; }
    else { textX = alignX(textW); textY = top + textH / 2; logoX = alignX(logo.w); logoY = top + textH + model.gap + logo.h / 2; }
  } else {
    const blockW = logo.w + model.gap + textW, blockH = Math.max(logo.h, textH), left = cx - blockW / 2, top = cy - blockH / 2;
    const alignY = (itemH) => model.verticalAlignment === 'start' ? top + itemH / 2 : model.verticalAlignment === 'end' ? top + blockH - itemH / 2 : cy;
    if (model.position === 'right') { logoX = left + logo.w / 2; textX = left + logo.w + model.gap + textW / 2; }
    else { textX = left + textW / 2; logoX = left + textW + model.gap + logo.w / 2; }
    logoY = alignY(logo.h); textY = alignY(textH);
  }
  return { logoX: logoX + model.logoOffsetX, logoY: logoY + model.logoOffsetY, textX: textX + model.textOffsetX, textY: textY + model.textOffsetY, logoW: logo.w, logoH: logo.h };
}
function drawGuides(context) {
  context.save();
  if (model.showGrid) {
    context.strokeStyle = 'rgba(255,255,255,.12)'; context.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const x = model.canvasWidth * i / 4, y = model.canvasHeight * i / 4; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, model.canvasHeight); context.stroke(); context.beginPath(); context.moveTo(0, y); context.lineTo(model.canvasWidth, y); context.stroke(); }
  }
  if (model.showMargins) {
    const mx = Math.min(model.marginX, model.canvasWidth / 2 - 1), my = Math.min(model.marginY, model.canvasHeight / 2 - 1);
    context.strokeStyle = 'rgba(255,255,255,.42)'; context.setLineDash([6, 6]); context.strokeRect(mx, my, Math.max(1, model.canvasWidth - mx * 2), Math.max(1, model.canvasHeight - my * 2)); context.setLineDash([]);
  }
  context.restore();
}
function renderFrame(t, targetCtx = ctx, width = canvas.width, height = canvas.height, options = {}) {
  const total = durationMs(), globalMs = clamp(t, 0, 1) * total;
  targetCtx.save(); targetCtx.clearRect(0, 0, width, height); targetCtx.scale(width / model.canvasWidth, height / model.canvasHeight);
  if (!options.transparent) { targetCtx.fillStyle = model.bgColor; targetCtx.fillRect(0, 0, model.canvasWidth, model.canvasHeight); }
  const textState = resolvedTextState(targetCtx), layout = lockupLayout(targetCtx, textState);
  const logoMotion = motionState('logo', globalMs);
  if (logoImage && logoMotion.alpha > .001) {
    targetCtx.save(); targetCtx.globalAlpha = clamp(logoMotion.alpha, 0, 1); targetCtx.translate(layout.logoX + logoMotion.x, layout.logoY + logoMotion.y); targetCtx.scale(logoMotion.scale, logoMotion.scale); targetCtx.drawImage(logoImage, -layout.logoW / 2, -layout.logoH / 2, layout.logoW, layout.logoH); targetCtx.restore();
  }
  const words = textWordLayout(targetCtx, textState.headline, textState);
  let wordX = textState.textAlign === 'left' ? layout.textX : textState.textAlign === 'right' ? layout.textX - words.totalWidth : layout.textX - words.totalWidth / 2;
  words.words.forEach((word, i) => {
    const motion = motionState('text', globalMs, i, words.words.length);
    targetCtx.save(); targetCtx.globalAlpha = clamp(motion.alpha, 0, 1); targetCtx.fillStyle = textState.textColor;
    const center = wordX + words.widths[i] / 2; targetCtx.translate(center + motion.x, layout.textY + motion.y); targetCtx.scale(motion.scale, motion.scale); targetCtx.translate(-center, -layout.textY); drawWord(targetCtx, word, wordX, layout.textY, textState); targetCtx.restore();
    wordX += words.widths[i] + words.space;
  });
  if (!options.hideGuides) drawGuides(targetCtx);
  targetCtx.restore();
}

function aspectFromSvg(svgText) {
  const m = svgText.match(/viewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)["']/i); if (!m) return null;
  const w = Number(m[1]), h = Number(m[2]); return w > 0 && h > 0 ? h / w : null;
}
function colorizeSvg(svgText, color) { return svgText.replace(/<svg([^>]*)>/i, (m) => `${m}<style>path,rect,circle,polygon,ellipse{fill:${color} !important;}</style>`); }
async function loadBuiltInLogo(type = model.logoType) {
  if (type === 'custom') { if (customLogo) logoImage = customLogo; renderFrame(playhead); return; }
  const token = ++logoToken;
  try {
    const res = await fetch(LOGOS[type] || LOGOS.wordmark); if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const source = await res.text(), parsedAspect = aspectFromSvg(source), blob = new Blob([colorizeSvg(source, model.logoColor)], { type: 'image/svg+xml' }), url = URL.createObjectURL(blob), image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    if (token !== logoToken) { URL.revokeObjectURL(url); return; }
    if (logoObjectUrl) URL.revokeObjectURL(logoObjectUrl); logoObjectUrl = url; logoImage = image; logoAspect = parsedAspect || image.naturalHeight / Math.max(1, image.naturalWidth); renderFrame(playhead);
  } catch (error) { $('status').textContent = `Logo load failed: ${error.message || error}`; }
}
async function loadGoogleFont() {
  const family = model.fontFamily.trim() || 'Anton', token = ++fontToken;
  $('fontStatus').textContent = `Loading ${family}…`;
  $('googleFontStylesheet').href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`;
  try { if (document.fonts) { await document.fonts.load(`${model.fontWeight} 48px "${family}"`); await document.fonts.ready; } if (token !== fontToken) return; $('fontStatus').textContent = `${family} loaded from Google Fonts.`; renderFrame(playhead); }
  catch { if (token !== fontToken) return; $('fontStatus').textContent = `Could not confirm ${family}; fallback may be shown.`; }
}

function applyCanvasSize() { canvas.width = model.canvasWidth; canvas.height = model.canvasHeight; $('canvasReadout').textContent = `${model.canvasWidth} × ${model.canvasHeight}`; syncViewport(); renderFrame(playhead); }
function syncViewport() {
  const z = model.viewportZoom; $('viewportZoom').value = String(z); $('fitBtn').classList.toggle('active', z === 'fit');
  if (z === 'fit') { canvas.style.width = ''; canvas.style.height = ''; canvas.style.maxWidth = ''; canvas.style.maxHeight = ''; $('stageShell').classList.remove('manual-zoom'); }
  else { const scale = clamp(num(z, 1), .25, 2); canvas.style.width = `${model.canvasWidth * scale}px`; canvas.style.height = `${model.canvasHeight * scale}px`; canvas.style.maxWidth = 'none'; canvas.style.maxHeight = 'none'; $('stageShell').classList.add('manual-zoom'); }
  $('viewportGridBtn').classList.toggle('active', model.showGrid); $('viewportSafeBtn').classList.toggle('active', model.showMargins);
}
function formatTime(ms) { return `${(ms / 1000).toFixed(2).replace(/\.00$/, '')}s`; }
function syncTimeUI() {
  const total = durationMs();
  $('totalTimeReadout').value = `${(total / 1000).toFixed(2)} s`; $('timelineStatus').textContent = formatTime(total);
  $('timelineRuler').innerHTML = [0, .25, .5, .75, 1].map((p) => `<span>${formatTime(total * p)}</span>`).join('');
  $('frameEstimate').textContent = String(Math.max(2, Math.min(300, Math.round(total / 1000 * model.fps))));
  $('outputSizeReadout').textContent = `${Math.round(model.canvasWidth * model.exportScale)} × ${Math.round(model.canvasHeight * model.exportScale)}`;
}
function syncTimeline() {
  const total = durationMs();
  for (const layer of ['logo', 'text']) {
    const l = model.layers[layer], bar = document.querySelector(`[data-bar="${layer}"]`), phases = phaseDurations(layer), phaseTotal = Math.max(1, phases.reduce((a, b) => a + b, 0));
    bar.style.left = `${l.start / total * 100}%`; bar.style.width = `${phaseTotal / total * 100}%`;
    const phaseEls = bar.querySelectorAll('.phase');
    phaseEls[0].style.width = `${phases[0] / phaseTotal * 100}%`; phaseEls[1].style.width = `${phases[1] / phaseTotal * 100}%`; phaseEls[2].style.width = `${phases[2] / phaseTotal * 100}%`;
    const enterHandle = bar.querySelector('.phase-handle.enter-end'), exitHandle = bar.querySelector('.phase-handle.exit-start');
    enterHandle.style.left = `${phases[0] / phaseTotal * 100}%`; exitHandle.style.left = `${(phases[0] + phases[1]) / phaseTotal * 100}%`;
    enterHandle.hidden = !['in-hold-out', 'in-out'].includes(l.mode); exitHandle.hidden = l.mode !== 'in-hold-out';
    $(`${layer}LayerTime`).textContent = `${formatTime(l.start)}–${formatTime(layerEnd(layer))}`;
  }
  updateTimelinePlayhead(); syncTimeUI();
}
function updateTimelinePlayhead() {
  const track = document.querySelector('.timing-track'), line = document.querySelector('.timeline-playhead'); if (!track || !line) return;
  const tr = $('timeline').getBoundingClientRect(), rr = track.getBoundingClientRect(); line.style.left = `${rr.left - tr.left + rr.width * playhead}px`;
}

function selectedMotion() { return model.layers[selectedLayer]; }
function syncMotionPanel() {
  const l = selectedMotion();
  $('motionLayerLabel').textContent = `${selectedLayer === 'logo' ? 'Logo' : 'Text'} layer`;
  $('motionLayerLogo').classList.toggle('active', selectedLayer === 'logo'); $('motionLayerText').classList.toggle('active', selectedLayer === 'text');
  $('layerStart').value = Math.round(l.start); $('flowMode').value = l.mode; $('enterDuration').value = Math.round(l.enter); $('holdDuration').value = Math.round(l.hold); $('exitDuration').value = Math.round(l.exit);
  $('enterDirection').value = l.enterDirection; $('exitDirection').value = l.exitDirection; $('layerTravel').value = l.travel; $('layerScale').value = l.scale; $('wordStagger').value = l.stagger; $('wordStaggerOut').value = `${Math.round(l.stagger)} ms`; $('staggerControl').hidden = selectedLayer !== 'text';
  syncCurveUI();
  document.querySelectorAll('[data-layer-select]').forEach((row) => row.classList.toggle('selected', row.dataset.layerSelect === selectedLayer));
}
function syncCurveUI() {
  const curve = selectedCurve === 'enter' ? selectedMotion().enterBezier : selectedMotion().exitBezier;
  [$('x1').value, $('y1').value, $('x2').value, $('y2').value] = curve.map(String); $('curveTarget').value = selectedCurve;
  const match = Object.entries(CURVE_PRESETS).find(([, v]) => v.every((n, i) => Math.abs(n - curve[i]) < .0001)); $('curvePreset').value = match ? match[0] : 'custom'; updateCurveViz();
}
function updateCurveViz() {
  const [x1, y1, x2, y2] = selectedCurve === 'enter' ? selectedMotion().enterBezier : selectedMotion().exitBezier;
  const left = 20, right = 240, top = 20, bottom = 150, sx = (x) => left + x * (right - left), sy = (y) => bottom - ((y + .25) / 1.5) * (bottom - top);
  const start = [sx(0), sy(0)], p1 = [sx(x1), sy(y1)], p2 = [sx(x2), sy(y2)], end = [sx(1), sy(1)];
  $('curvePath').setAttribute('d', `M${start[0]} ${start[1]} C${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]} ${end[0]} ${end[1]}`); $('guide1').setAttribute('d', `M${start[0]} ${start[1]} L${p1[0]} ${p1[1]}`); $('guide2').setAttribute('d', `M${end[0]} ${end[1]} L${p2[0]} ${p2[1]}`); $('handle1').setAttribute('cx', p1[0]); $('handle1').setAttribute('cy', p1[1]); $('handle2').setAttribute('cx', p2[0]); $('handle2').setAttribute('cy', p2[1]);
}
function syncForm() {
  const ids = ['headline','fontFamily','fontSize','fontWeight','letterSpacing','wordSpacing','textAlign','textTransform','textColor','position','gap','alignment','verticalAlignment','offsetX','offsetY','logoOffsetX','logoOffsetY','textOffsetX','textOffsetY','logoSize','logoColor','canvasWidth','canvasHeight','bgColor','marginX','marginY','fps','exportScale','gifColors','playbackRate'];
  ids.forEach((id) => { if ($(id)) $(id).value = String(model[id]); });
  ['autoFit','showMargins','showGrid','gifLoop'].forEach((id) => { $(id).checked = Boolean(model[id]); });
  document.querySelectorAll('[data-logo-type]').forEach((b) => b.classList.toggle('active', b.dataset.logoType === model.logoType));
  $('loopBtn').classList.toggle('active', model.previewLoop); $('loopBtn').setAttribute('aria-pressed', String(model.previewLoop)); $('snapBtn').classList.toggle('active', model.snap); $('snapBtn').setAttribute('aria-pressed', String(model.snap));
  syncMotionPanel();
}
function syncAll({ reloadLogo = false, reloadFont = false } = {}) { syncForm(); applyCanvasSize(); syncTimeline(); syncViewport(); syncPlayhead(); if (reloadLogo) loadBuiltInLogo(model.logoType); if (reloadFont) loadGoogleFont(); }

function setPlayButton() { const span = $('playBtn').querySelector('span'); if (span) span.textContent = isPlaying ? 'Pause' : 'Play'; $('playBtn').classList.toggle('playing', isPlaying); }
function syncPlayhead() { $('scrubber').value = String(playhead); $('timeReadout').value = `${(playhead * durationMs() / 1000).toFixed(2)} s`; renderFrame(playhead); updateTimelinePlayhead(); }
function pause() { isPlaying = false; if (rafId) cancelAnimationFrame(rafId); rafId = null; playbackOffsetMs = playhead * durationMs(); setPlayButton(); }
function tick(now) {
  if (!isPlaying) return; const total = durationMs(), elapsed = (now - playbackStartedAt) * model.playbackRate + playbackOffsetMs;
  playhead = model.previewLoop ? (elapsed % total) / total : clamp(elapsed / total, 0, 1); syncPlayhead(); if (!model.previewLoop && playhead >= 1) { pause(); return; } rafId = requestAnimationFrame(tick);
}
function play() { if (isPlaying) { pause(); return; } if (playhead >= 1) playhead = 0; playbackOffsetMs = playhead * durationMs(); playbackStartedAt = performance.now(); isPlaying = true; setPlayButton(); rafId = requestAnimationFrame(tick); }
function restart() { pause(); playhead = 0; playbackOffsetMs = 0; syncPlayhead(); }
function stepFrame(dir) { pause(); const frames = Math.max(2, Math.round(durationMs() / 1000 * model.fps)); playhead = clamp(playhead + dir / Math.max(1, frames - 1), 0, 1); playbackOffsetMs = playhead * durationMs(); syncPlayhead(); }
function snapMs(ms) { if (!model.snap) return ms; return Math.round(ms / (1000 / Math.max(1, model.fps))) * (1000 / Math.max(1, model.fps)); }

function bindBaseInput(id, key = id, { numeric = false, checkbox = false, after } = {}) {
  const el = $(id); if (!el) return;
  const update = () => { model[key] = checkbox ? el.checked : numeric ? num(el.value, model[key]) : el.value; if (after) after(); else { syncTimeline(); renderFrame(playhead); } scheduleSave(); };
  el.addEventListener('input', update); el.addEventListener('change', () => { update(); commitHistory(); });
}
function setupBaseBindings() {
  ['headline','fontFamily','textAlign','textTransform','textColor','position','alignment','verticalAlignment','bgColor'].forEach((id) => bindBaseInput(id));
  ['fontSize','fontWeight','letterSpacing','wordSpacing','gap','offsetX','offsetY','logoOffsetX','logoOffsetY','textOffsetX','textOffsetY','logoSize','marginX','marginY','fps'].forEach((id) => bindBaseInput(id, id, { numeric: true }));
  ['autoFit','showMargins','showGrid'].forEach((id) => bindBaseInput(id, id, { checkbox: true, after: () => { syncViewport(); renderFrame(playhead); } }));
  bindBaseInput('exportScale','exportScale',{numeric:true,after:syncTimeUI}); bindBaseInput('gifColors','gifColors',{numeric:true,after:syncTimeUI}); bindBaseInput('gifLoop','gifLoop',{checkbox:true,after:syncTimeUI});
  bindBaseInput('playbackRate','playbackRate',{numeric:true,after:()=>{ if(isPlaying){playbackOffsetMs=playhead*durationMs();playbackStartedAt=performance.now();}}});
  $('fontWeight').addEventListener('change', loadGoogleFont); $('loadFontBtn').addEventListener('click', () => { model.fontFamily = $('fontFamily').value.trim() || 'Anton'; loadGoogleFont(); commitHistory(); }); $('fontFamily').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('loadFontBtn').click(); } });
  $('logoColor').addEventListener('input', () => { model.logoColor = $('logoColor').value; if (model.logoType !== 'custom') loadBuiltInLogo(model.logoType); }); $('logoColor').addEventListener('change', commitHistory);
  document.querySelectorAll('[data-logo-type]').forEach((button) => button.addEventListener('click', () => { model.logoType = button.dataset.logoType; document.querySelectorAll('[data-logo-type]').forEach((b) => b.classList.toggle('active', b === button)); loadBuiltInLogo(model.logoType); commitHistory(); }));
  $('logoFile').addEventListener('change', async () => {
    const file = $('logoFile').files?.[0]; if (!file) return; let uploadedAspect = null;
    if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) { try { uploadedAspect = aspectFromSvg(await file.text()); } catch {} }
    const url = URL.createObjectURL(file), image = new Image(); image.onload = () => { customLogo = image; logoImage = image; logoAspect = uploadedAspect || image.naturalHeight / Math.max(1, image.naturalWidth); model.logoType = 'custom'; if (logoObjectUrl) URL.revokeObjectURL(logoObjectUrl); logoObjectUrl = url; document.querySelectorAll('[data-logo-type]').forEach((b) => b.classList.remove('active')); renderFrame(playhead); commitHistory(); }; image.onerror = () => { URL.revokeObjectURL(url); $('status').textContent = 'Could not read that logo file.'; }; image.src = url;
  });
}

function setupMotionBindings() {
  const selectLayer = (layer) => { selectedLayer = layer; syncMotionPanel(); renderFrame(playhead); };
  $('motionLayerLogo').addEventListener('click', () => selectLayer('logo')); $('motionLayerText').addEventListener('click', () => selectLayer('text'));
  document.querySelectorAll('[data-layer-select]').forEach((row) => row.addEventListener('click', () => { selectLayer(row.dataset.layerSelect); document.querySelector('.tab[data-tab="motion"]')?.click(); }));
  const bind = (id, prop, { numeric = false, after } = {}) => { const el = $(id); const update = () => { selectedMotion()[prop] = numeric ? num(el.value, selectedMotion()[prop]) : el.value; if (after) after(); else { syncTimeline(); renderFrame(playhead); } scheduleSave(); }; el.addEventListener('input', update); el.addEventListener('change', () => { update(); commitHistory(); }); };
  bind('layerStart','start',{numeric:true,after:()=>{selectedMotion().start=Math.max(0,snapMs(selectedMotion().start));syncMotionPanel();syncTimeline();syncPlayhead();}});
  bind('flowMode','mode',{after:()=>{syncTimeline();syncPlayhead();}}); bind('enterDuration','enter',{numeric:true,after:()=>{selectedMotion().enter=Math.max(0,snapMs(selectedMotion().enter));syncMotionPanel();syncTimeline();syncPlayhead();}}); bind('holdDuration','hold',{numeric:true,after:()=>{selectedMotion().hold=Math.max(0,snapMs(selectedMotion().hold));syncMotionPanel();syncTimeline();syncPlayhead();}}); bind('exitDuration','exit',{numeric:true,after:()=>{selectedMotion().exit=Math.max(0,snapMs(selectedMotion().exit));syncMotionPanel();syncTimeline();syncPlayhead();}});
  bind('enterDirection','enterDirection'); bind('exitDirection','exitDirection'); bind('layerTravel','travel',{numeric:true}); bind('layerScale','scale',{numeric:true}); bind('wordStagger','stagger',{numeric:true,after:()=>{$('wordStaggerOut').value=`${Math.round(selectedMotion().stagger)} ms`;renderFrame(playhead);}});
  document.querySelectorAll('[data-motion-preset]').forEach((button) => button.addEventListener('click', () => { const p = MOTION_PRESETS[button.dataset.motionPreset]; if (!p) return; const l = selectedMotion(); l.enter=p.enter;l.hold=p.hold;l.exit=p.exit;l.travel=p.travel;l.scale=p.scale;if(selectedLayer==='text')l.stagger=p.stagger;l.enterBezier=[...p.enterBezier];l.exitBezier=[...p.exitBezier];syncMotionPanel();syncTimeline();syncPlayhead();commitHistory(); }));
}

function setupCurveEditor() {
  $('curveTarget').addEventListener('change', () => { selectedCurve = $('curveTarget').value; syncCurveUI(); });
  $('curvePreset').addEventListener('change', () => { const p = CURVE_PRESETS[$('curvePreset').value]; if (!p) return; selectedMotion()[selectedCurve === 'enter' ? 'enterBezier' : 'exitBezier'] = [...p]; syncCurveUI(); renderFrame(playhead); commitHistory(); });
  const updateFields = () => { selectedMotion()[selectedCurve === 'enter' ? 'enterBezier' : 'exitBezier'] = [clamp(num($('x1').value, 0), 0, 1), num($('y1').value, .9), clamp(num($('x2').value, 0), 0, 1), num($('y2').value, 1)]; $('curvePreset').value='custom'; updateCurveViz(); renderFrame(playhead); scheduleSave(); };
  ['x1','y1','x2','y2'].forEach((id) => { $(id).addEventListener('input', updateFields); $(id).addEventListener('change', () => { updateFields(); commitHistory(); }); });
  const toSvgPoint = (event) => { const matrix = $('curveViz').getScreenCTM(); if (!matrix) return null; const point = $('curveViz').createSVGPoint(); point.x=event.clientX;point.y=event.clientY;return point.matrixTransform(matrix.inverse()); };
  const begin = (which,e) => { activeDrag={kind:'curve',which,pointerId:e.pointerId}; e.target.setPointerCapture?.(e.pointerId); e.preventDefault(); };
  $('handle1').addEventListener('pointerdown',(e)=>begin(1,e)); $('handle2').addEventListener('pointerdown',(e)=>begin(2,e));
  $('curveViz').addEventListener('pointermove',(e)=>{ if(activeDrag?.kind!=='curve')return;const p=toSvgPoint(e);if(!p)return;const x=clamp((p.x-20)/220,0,1),y=clamp(((150-p.y)/130)*1.5-.25,-2,3),curve=[...(selectedCurve==='enter'?selectedMotion().enterBezier:selectedMotion().exitBezier)];curve[activeDrag.which===1?0:2]=Number(x.toFixed(2));curve[activeDrag.which===1?1:3]=Number(y.toFixed(2));selectedMotion()[selectedCurve==='enter'?'enterBezier':'exitBezier']=curve;syncCurveUI();renderFrame(playhead);scheduleSave();});
  const end = () => { if(activeDrag?.kind==='curve'){activeDrag=null;commitHistory();} }; $('curveViz').addEventListener('pointerup',end);$('curveViz').addEventListener('pointercancel',end);
}

function setupTimeline() {
  const trackRect = () => document.querySelector('.timing-track').getBoundingClientRect();
  $('timeline').addEventListener('pointerdown', (event) => {
    const phaseHandle = event.target.closest('.phase-handle'), edge = event.target.closest('.timing-handle'), bar = event.target.closest('.timing-bar'), track = event.target.closest('.timing-track'); if (!bar && !track) return;
    const layer = bar?.dataset.bar || track?.dataset.track, l = model.layers[layer], rect = trackRect();
    selectedLayer = layer; syncMotionPanel();
    activeDrag = { kind: phaseHandle ? (phaseHandle.classList.contains('enter-end') ? 'enter-boundary' : 'hold-boundary') : edge ? (edge.classList.contains('end') ? 'end' : 'start') : bar ? 'bar' : 'scrub', layer, rect, x0:event.clientX, start0:l.start, enter0:l.enter, hold0:l.hold, exit0:l.exit, total0:durationMs() };
    (bar || track).setPointerCapture?.(event.pointerId); event.preventDefault();
    if (activeDrag.kind === 'scrub') { pause(); playhead = clamp((event.clientX - rect.left) / rect.width, 0, 1); syncPlayhead(); }
  });
  $('timeline').addEventListener('pointermove', (event) => {
    if (!activeDrag || activeDrag.kind === 'curve') return; const a=activeDrag,l=model.layers[a.layer],dxMs=(event.clientX-a.x0)/Math.max(1,a.rect.width)*a.total0;
    if(a.kind==='scrub'){playhead=clamp((event.clientX-a.rect.left)/a.rect.width,0,1);syncPlayhead();return;}
    if(a.kind==='bar'||a.kind==='start'){l.start=Math.max(0,snapMs(a.start0+dxMs));}
    else if(a.kind==='enter-boundary'){
      const totalPhase=a.enter0+a.hold0+a.exit0, boundary=clamp(snapMs(a.enter0+dxMs),0,Math.max(0,totalPhase-a.exit0)); l.enter=boundary; l.hold=Math.max(0,totalPhase-l.enter-a.exit0);
    } else if(a.kind==='hold-boundary'){
      const totalPhase=a.enter0+a.hold0+a.exit0, boundary=clamp(snapMs(a.enter0+a.hold0+dxMs),a.enter0,totalPhase); l.hold=Math.max(0,boundary-a.enter0); l.exit=Math.max(0,totalPhase-a.enter0-l.hold);
    } else if(a.kind==='end') { l.exit=Math.max(0,snapMs(a.exit0+dxMs)); }
    syncMotionPanel();syncTimeline();syncPlayhead();scheduleSave();
  });
  const stop=()=>{if(activeDrag&&activeDrag.kind!=='curve'){const scrub=activeDrag.kind==='scrub';activeDrag=null;if(!scrub)commitHistory();}}; $('timeline').addEventListener('pointerup',stop);$('timeline').addEventListener('pointercancel',stop);
  $('timelineRuler').addEventListener('pointerdown',(event)=>{const rect=trackRect();pause();playhead=clamp((event.clientX-rect.left)/rect.width,0,1);syncPlayhead();});
}

function setupCanvasControls() {
  $('canvasPreset').addEventListener('change',()=>{const p=CANVAS_PRESETS[$('canvasPreset').value];if(!p)return;[model.canvasWidth,model.canvasHeight]=p;syncForm();applyCanvasSize();syncTimeUI();commitHistory();});
  ['canvasWidth','canvasHeight'].forEach((id)=>$(id).addEventListener('change',()=>{model[id]=clamp(Math.round(num($(id).value,model[id])),120,4096);$('canvasPreset').value='custom';applyCanvasSize();syncTimeUI();commitHistory();}));
  $('fitBtn').addEventListener('click',()=>{model.viewportZoom='fit';syncViewport();scheduleSave();});$('viewportZoom').addEventListener('change',()=>{model.viewportZoom=$('viewportZoom').value==='fit'?'fit':num($('viewportZoom').value,1);syncViewport();scheduleSave();});
  $('viewportGridBtn').addEventListener('click',()=>{model.showGrid=!model.showGrid;$('showGrid').checked=model.showGrid;syncViewport();renderFrame(playhead);commitHistory();}); $('viewportSafeBtn').addEventListener('click',()=>{model.showMargins=!model.showMargins;$('showMargins').checked=model.showMargins;syncViewport();renderFrame(playhead);commitHistory();});
}
function setupTabs(){document.querySelectorAll('.tab').forEach((tab)=>tab.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach((x)=>x.classList.toggle('active',x===tab));document.querySelectorAll('.tab-panel').forEach((panel)=>panel.classList.toggle('active',panel.dataset.panel===tab.dataset.tab));}));}

async function exportGif(){const frames=Math.max(2,Math.min(300,Math.round(durationMs()/1000*model.fps))),delay=Math.round(1000/model.fps),scale=model.exportScale;$('exportBtn').disabled=true;$('exportProgress').value=0;$('status').textContent='Loading GIF encoder…';try{const{GIFEncoder,quantize,applyPalette}=await import('https://unpkg.com/gifenc@1.0.3?module');const out=document.createElement('canvas');out.width=Math.round(model.canvasWidth*scale);out.height=Math.round(model.canvasHeight*scale);const outCtx=out.getContext('2d',{willReadFrequently:true}),gif=GIFEncoder();for(let i=0;i<frames;i++){const t=i/(frames-1);renderFrame(t,outCtx,out.width,out.height,{hideGuides:true});const rgba=outCtx.getImageData(0,0,out.width,out.height).data,palette=quantize(rgba,model.gifColors,{format:'rgb565'}),indexed=applyPalette(rgba,palette,'rgb565');gif.writeFrame(indexed,out.width,out.height,{palette,delay,repeat:model.gifLoop?0:-1});$('exportProgress').value=(i+1)/frames;$('status').textContent=`Encoding ${i+1} / ${frames}…`;if(i%3===0)await new Promise((r)=>setTimeout(r,0));}gif.finish();const blob=new Blob([gif.bytes()],{type:'image/gif'});downloadBlob(blob,`anim-${model.canvasWidth}x${model.canvasHeight}.gif`);$('status').textContent=`Done — ${(blob.size/1024/1024).toFixed(1)} MB GIF.`;}catch(error){console.error(error);$('status').textContent=`Export failed: ${error.message||error}`;}finally{$('exportBtn').disabled=false;}}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);}
function exportPng(){const out=document.createElement('canvas');out.width=Math.round(model.canvasWidth*model.exportScale);out.height=Math.round(model.canvasHeight*model.exportScale);renderFrame(playhead,out.getContext('2d'),out.width,out.height,{hideGuides:true});out.toBlob((blob)=>blob&&downloadBlob(blob,`anim-frame-${model.canvasWidth}x${model.canvasHeight}.png`),'image/png');}
function downloadSetup(){const safe=clone(model);if(safe.logoType==='custom')safe.logoType='wordmark';downloadBlob(new Blob([JSON.stringify({version:4,model:safe},null,2)],{type:'application/json'}),'animation-studio-setup.json');}
async function importSetup(file){if(!file)return;try{const parsed=JSON.parse(await file.text()),incoming=parsed.model||parsed;if(!incoming?.layers?.logo||!incoming?.layers?.text)throw new Error('Invalid setup');model={...clone(DEFAULT_MODEL),...incoming,layers:{logo:{...clone(DEFAULT_MODEL.layers.logo),...incoming.layers.logo},text:{...clone(DEFAULT_MODEL.layers.text),...incoming.layers.text}}};history=[JSON.stringify(model)];historyIndex=0;syncAll({reloadLogo:true,reloadFont:true});saveNow();$('status').textContent='Setup loaded.';}catch{$('status').textContent='Could not load setup.';}finally{$('setupFile').value='';}}
function resetDefaults(){model=clone(DEFAULT_MODEL);selectedLayer='logo';selectedCurve='enter';playhead=0;customLogo=null;$('logoFile').value='';history=[JSON.stringify(model)];historyIndex=0;syncAll({reloadLogo:true,reloadFont:true});syncHistoryButtons();saveNow();}

function setupCommands(){
  $('playBtn').addEventListener('click',play);$('restartBtn').addEventListener('click',restart);$('prevFrameBtn').addEventListener('click',()=>stepFrame(-1));$('nextFrameBtn').addEventListener('click',()=>stepFrame(1));$('scrubber').addEventListener('input',()=>{pause();playhead=clamp(num($('scrubber').value,0),0,1);playbackOffsetMs=playhead*durationMs();syncPlayhead();});
  $('loopBtn').addEventListener('click',()=>{model.previewLoop=!model.previewLoop;$('loopBtn').classList.toggle('active',model.previewLoop);$('loopBtn').setAttribute('aria-pressed',String(model.previewLoop));commitHistory();});$('snapBtn').addEventListener('click',()=>{model.snap=!model.snap;$('snapBtn').classList.toggle('active',model.snap);$('snapBtn').setAttribute('aria-pressed',String(model.snap));commitHistory();});
  $('undoBtn').addEventListener('click',undo);$('redoBtn').addEventListener('click',redo);$('resetBtn').addEventListener('click',resetDefaults);$('exportBtn').addEventListener('click',exportGif);$('pngBtn').addEventListener('click',exportPng);$('downloadSetupBtn').addEventListener('click',downloadSetup);$('loadSetupBtn').addEventListener('click',()=>$('setupFile').click());$('setupFile').addEventListener('change',()=>importSetup($('setupFile').files?.[0]));
  window.addEventListener('keydown',(e)=>{const editable=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}if(editable)return;if(e.code==='Space'){e.preventDefault();play();}if(e.key==='ArrowLeft'){e.preventDefault();stepFrame(-1);}if(e.key==='ArrowRight'){e.preventDefault();stepFrame(1);}if(e.key.toLowerCase()==='l'){$('loopBtn').click();}if(e.key.toLowerCase()==='s'){$('snapBtn').click();}});
  window.addEventListener('resize',()=>{updateTimelinePlayhead();if(model.viewportZoom==='fit')syncViewport();});window.addEventListener('beforeunload',saveNow);
}

async function initialize(){
  loadSaved(); setupBaseBindings(); setupMotionBindings(); setupCurveEditor(); setupTimeline(); setupCanvasControls(); setupTabs(); setupCommands(); syncAll(); syncHistoryButtons(); await loadBuiltInLogo(model.logoType); loadGoogleFont(); syncPlayhead(); saveNow();
}
initialize();