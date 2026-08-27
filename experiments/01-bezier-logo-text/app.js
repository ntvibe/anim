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
  '1:1': [1080, 1080], '16:9': [1920, 1080], '9:16': [1080, 1920], '4:5': [1080, 1350], '4:3': [1200, 900], banner: [1200, 400],
};
const PRESETS = {
  '0.22,1,0.36,1': [0.22, 1, 0.36, 1],
  '0.16,1,0.3,1': [0.16, 1, 0.3, 1],
  '0.65,0,0.35,1': [0.65, 0, 0.35, 1],
  '0.34,1.56,0.64,1': [0.34, 1.56, 0.64, 1],
  '0.05,0.9,0.1,1': [0.05, 0.9, 0.1, 1],
};

const ui = Object.fromEntries([
  'googleFontStylesheet','headline','fontFamily','loadFontBtn','fontStatus','autoFit','fontSize','fontWeight','letterSpacing','wordSpacing','textAlign','textTransform','textColor',
  'position','gap','alignment','verticalAlignment','offsetX','offsetY','logoOffsetX','logoOffsetY','textOffsetX','textOffsetY',
  'logoType','logoFile','logoSize','logoColor','logoPicker',
  'flowMode','enterDuration','holdDuration','exitDuration','enterDirection','exitDirection','logoTravel','textTravel','logoScale','textScale','wordStagger','wordStaggerOut',
  'curveTarget','preset','curveViz','curvePath','guide1','guide2','handle1','handle2','x1','y1','x2','y2',
  'canvasPreset','canvasWidth','canvasHeight','canvasReadout','bgColor','marginX','marginY','showMargins','showGrid','stageShell','fitBtn','viewportZoom','viewportGridBtn','viewportSafeBtn',
  'exportFormat','fps','exportScale','gifColors','gifLoop','frameEstimate','outputSizeReadout','exportBtn','topExportBtn','pngBtn','exportProgress','status',
  'playBtn','restartBtn','prevFrameBtn','nextFrameBtn','playbackRate','previewLoop','scrubber','timeReadout','totalTimeReadout',
  'timeline','timelineRuler','timelineStatus','logoStart','logoEnd','textStart','textEnd','logoTimingLabel','textTimingLabel',
  'resetBtn','undoBtn','redoBtn','inspectorTitle'
].map((id) => [id, $(id)]));

const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const DEFAULT_MODEL = {
  headline: 'MORGEN MACHT MAN HEUTE.', fontFamily: 'Anton', fontSize: 52, fontWeight: 400, letterSpacing: 2, wordSpacing: 0,
  textAlign: 'center', textTransform: 'uppercase', textColor: '#ffffff', autoFit: true,
  position: 'below', gap: 28, alignment: 'center', verticalAlignment: 'center', offsetX: 0, offsetY: 0,
  logoOffsetX: 0, logoOffsetY: 0, textOffsetX: 0, textOffsetY: 0,
  logoType: 'wordmark', logoSize: 220, logoColor: '#ffffff',
  flowMode: 'in-hold-out', enterDuration: 850, holdDuration: 350, exitDuration: 750,
  enterDirection: 'from-bottom', exitDirection: 'to-top', logoTravel: 50, textTravel: 50, logoScale: 0.94, textScale: 0.96, wordStagger: 35,
  enterBezier: [0.05, 0.9, 0.1, 1], exitBezier: [0.85, 0, 1, 0.2],
  logoStart: 0, logoEnd: 1950, logoEndPinned: true, textStart: 120, textEnd: 1950, textEndPinned: true,
  canvasWidth: 800, canvasHeight: 450, bgColor: '#103e36', marginX: 60, marginY: 40, showMargins: true, showGrid: false,
  fps: 30, exportScale: 1, gifColors: 256, gifLoop: true,
  playbackRate: 1, previewLoop: false, viewportZoom: 'fit',
};
let model = clone(DEFAULT_MODEL);
let selectedCurve = 'enter';
let selectedLayer = 'lockup';
let customLogo = null;
let logoImage = null;
let logoAspect = 160 / 704;
let logoObjectUrl = null;
let logoLoadToken = 0;
let fontLoadToken = 0;
let playhead = 0;
let isPlaying = false;
let rafId = null;
let playbackStartedAt = 0;
let playbackOffsetMs = 0;
let activeDrag = null;
let history = [JSON.stringify(model)];
let historyIndex = 0;

function durationMs(m = model) {
  if (m.flowMode === 'out-only') return Math.max(50, m.exitDuration);
  if (m.flowMode === 'in-only') return Math.max(50, m.enterDuration);
  if (m.flowMode === 'in-stay') return Math.max(50, m.enterDuration + m.holdDuration);
  if (m.flowMode === 'in-out') return Math.max(100, m.enterDuration + m.exitDuration);
  if (m.flowMode === 'static') return Math.max(250, m.holdDuration || 1000);
  return Math.max(100, m.enterDuration + m.holdDuration + m.exitDuration);
}
function resolvedRange(layer, m = model) {
  const total = durationMs(m);
  const startKey = `${layer}Start`, endKey = `${layer}End`, pinKey = `${layer}EndPinned`;
  const start = clamp(num(m[startKey], 0), 0, Math.max(0, total - 10));
  const endRaw = m[pinKey] ? total : num(m[endKey], total);
  const end = clamp(endRaw, Math.min(total, start + 10), total);
  return [start, end];
}
function phaseDurations(m = model) {
  if (m.flowMode === 'out-only') return [0, 0, durationMs(m)];
  if (m.flowMode === 'in-only') return [durationMs(m), 0, 0];
  if (m.flowMode === 'in-stay') return [m.enterDuration, m.holdDuration, 0];
  if (m.flowMode === 'in-out') return [m.enterDuration, 0, m.exitDuration];
  if (m.flowMode === 'static') return [0, durationMs(m), 0];
  return [m.enterDuration, m.holdDuration, m.exitDuration];
}
function phaseFractions(m = model) {
  const phases = phaseDurations(m), total = Math.max(1, phases.reduce((a, b) => a + b, 0));
  return phases.map((v) => v / total);
}
function transformText(text, transform) {
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize') return text.replace(/\b\w/g, (c) => c.toUpperCase());
  return text;
}
function renderState() {
  const total = durationMs();
  const [logoStart, logoEnd] = resolvedRange('logo');
  const [textStart, textEnd] = resolvedRange('text');
  return {
    ...model,
    headline: transformText(model.headline || ' ', model.textTransform),
    lifecycleDuration: total,
    logoStart: total ? logoStart / total : 0, logoEnd: total ? logoEnd / total : 1,
    textStart: total ? textStart / total : 0, textEnd: total ? textEnd / total : 1,
  };
}

function historySnapshot() { return JSON.stringify(model); }
function syncHistoryButtons() { ui.undoBtn.disabled = historyIndex <= 0; ui.redoBtn.disabled = historyIndex >= history.length - 1; }
function commitHistory() {
  const snap = historySnapshot(); if (history[historyIndex] === snap) return;
  history = history.slice(0, historyIndex + 1); history.push(snap);
  if (history.length > 80) history.shift(); else historyIndex += 1;
  if (history.length > 80) historyIndex = history.length - 1; syncHistoryButtons();
}
function restoreHistory(index) { if (index < 0 || index >= history.length) return; historyIndex = index; model = JSON.parse(history[index]); syncAll({ reloadFont: true, reloadLogo: true }); syncHistoryButtons(); }
function undo() { restoreHistory(historyIndex - 1); }
function redo() { restoreHistory(historyIndex + 1); }

function bezierCoord(t, a1, a2) { const o = 1 - t; return 3 * o * o * t * a1 + 3 * o * t * t * a2 + t * t * t; }
function bezierDerivative(t, a1, a2) { const o = 1 - t; return 3 * o * o * a1 + 6 * o * t * (a2 - a1) + 3 * t * t * (1 - a2); }
function cubicBezierEase(x, x1, y1, x2, y2) {
  x = clamp(x, 0, 1); let t = x;
  for (let i = 0; i < 7; i++) { const error = bezierCoord(t, x1, x2) - x, slope = bezierDerivative(t, x1, x2); if (Math.abs(error) < 1e-6 || Math.abs(slope) < 1e-6) break; t = clamp(t - error / slope, 0, 1); }
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) { const current = bezierCoord(t, x1, x2); if (Math.abs(current - x) < 1e-6) break; if (current < x) lo = t; else hi = t; t = (lo + hi) / 2; }
  return bezierCoord(t, y1, y2);
}
function rangeProgress(t, start, end) { return end <= start ? (t >= end ? 1 : 0) : clamp((t - start) / (end - start), 0, 1); }
function directionVector(value) { if (value.endsWith('left')) return [-1, 0]; if (value.endsWith('right')) return [1, 0]; if (value.endsWith('top')) return [0, -1]; if (value.endsWith('bottom')) return [0, 1]; return [0, 0]; }
function lifecycleState(localT, s, travel, startScale, wordIndex = 0, wordCount = 1) {
  if (s.flowMode === 'static') return { alpha: 1, x: 0, y: 0, scale: 1 };
  const total = s.lifecycleDuration, localMs = clamp(localT, 0, 1) * total, enterVec = directionVector(s.enterDirection), exitVec = directionVector(s.exitDirection);
  if (s.flowMode === 'out-only') { const p = cubicBezierEase(clamp(localMs / Math.max(1, s.exitDuration), 0, 1), ...s.exitBezier); return { alpha: 1 - p, x: exitVec[0] * travel * p, y: exitVec[1] * travel * p, scale: 1 }; }
  const stagger = wordCount > 1 ? wordIndex * s.wordStagger : 0, enterStart = stagger, enterEnd = Math.min(total, enterStart + s.enterDuration);
  if (localMs < enterEnd) { const p = cubicBezierEase(clamp((localMs - enterStart) / Math.max(1, enterEnd - enterStart), 0, 1), ...s.enterBezier); return { alpha: p, x: enterVec[0] * travel * (1 - p), y: enterVec[1] * travel * (1 - p), scale: lerp(startScale, 1, p) }; }
  if (s.flowMode === 'in-only' || s.flowMode === 'in-stay') return { alpha: 1, x: 0, y: 0, scale: 1 };
  const exitStart = s.flowMode === 'in-out' ? s.enterDuration : s.enterDuration + s.holdDuration;
  if (localMs <= exitStart) return { alpha: 1, x: 0, y: 0, scale: 1 };
  const p = cubicBezierEase(clamp((localMs - exitStart) / Math.max(1, s.exitDuration), 0, 1), ...s.exitBezier);
  return { alpha: 1 - p, x: exitVec[0] * travel * p, y: exitVec[1] * travel * p, scale: 1 };
}

function fontString(s) { return `${s.fontWeight} ${s.fontSize}px "${s.fontFamily.replace(/"/g, '')}", sans-serif`; }
function measureSpacedText(context, text, s) { context.font = fontString(s); let width = 0; for (let i = 0; i < text.length; i++) { const ch = text[i]; width += context.measureText(ch).width; if (i < text.length - 1) width += ch === ' ' ? s.wordSpacing + s.letterSpacing : s.letterSpacing; } return width; }
function drawWord(context, word, x, y, s) { context.font = fontString(s); context.textAlign = 'left'; context.textBaseline = 'middle'; let cursor = x; for (let i = 0; i < word.length; i++) { const ch = word[i]; context.fillText(ch, cursor, y); cursor += context.measureText(ch).width + (i < word.length - 1 ? s.letterSpacing : 0); } }
function textWordLayout(context, text, s) { const words = text.split(/\s+/).filter(Boolean), widths = words.map((w) => measureSpacedText(context, w, { ...s, wordSpacing: 0 })); context.font = fontString(s); const space = context.measureText(' ').width + s.wordSpacing + s.letterSpacing; return { words, widths, space, totalWidth: widths.reduce((a, b) => a + b, 0) + Math.max(0, words.length - 1) * space }; }
function logoDimensions(s) { return { w: s.logoSize, h: s.logoSize * (Number.isFinite(logoAspect) && logoAspect > 0 ? logoAspect : .28) }; }
function resolvedTextState(context, s, width) {
  if (!s.autoFit) return s; const logo = logoDimensions(s), safeWidth = Math.max(40, width - Math.min(s.marginX, width / 2 - 1) * 2), maxTextWidth = (s.position === 'left' || s.position === 'right') ? Math.max(40, safeWidth - logo.w - s.gap) : safeWidth;
  let size = s.fontSize, candidate = { ...s, fontSize: size }; while (size > 10 && measureSpacedText(context, candidate.headline, candidate) > maxTextWidth) { size -= 1; candidate = { ...s, fontSize: size }; } return candidate;
}
function lockupLayout(context, s, width, height) {
  const logo = logoDimensions(s), textW = measureSpacedText(context, s.headline, s), textH = s.fontSize * 1.05, cx = width / 2 + s.offsetX, cy = height / 2 + s.offsetY;
  let logoX = cx, logoY = cy, textX = cx, textY = cy;
  if (s.position === 'below' || s.position === 'above') {
    const blockW = Math.max(logo.w, textW), blockH = logo.h + s.gap + textH, left = cx - blockW / 2, alignX = (itemW) => s.alignment === 'start' ? left + itemW / 2 : s.alignment === 'end' ? left + blockW - itemW / 2 : cx, top = cy - blockH / 2;
    if (s.position === 'below') { logoX = alignX(logo.w); logoY = top + logo.h / 2; textX = alignX(textW); textY = top + logo.h + s.gap + textH / 2; }
    else { textX = alignX(textW); textY = top + textH / 2; logoX = alignX(logo.w); logoY = top + textH + s.gap + logo.h / 2; }
  } else {
    const blockW = logo.w + s.gap + textW, blockH = Math.max(logo.h, textH), left = cx - blockW / 2, top = cy - blockH / 2, alignY = (itemH) => s.verticalAlignment === 'start' ? top + itemH / 2 : s.verticalAlignment === 'end' ? top + blockH - itemH / 2 : cy;
    if (s.position === 'right') { logoX = left + logo.w / 2; textX = left + logo.w + s.gap + textW / 2; } else { textX = left + textW / 2; logoX = left + textW + s.gap + logo.w / 2; }
    logoY = alignY(logo.h); textY = alignY(textH);
  }
  return { logoX: logoX + s.logoOffsetX, logoY: logoY + s.logoOffsetY, textX: textX + s.textOffsetX, textY: textY + s.textOffsetY, logoW: logo.w, logoH: logo.h, textW, textH };
}
function drawGuides(context, s, width, height) {
  context.save(); if (s.showGrid) { context.strokeStyle = 'rgba(255,255,255,.12)'; context.lineWidth = 1; for (let i = 1; i < 4; i++) { const x = width * i / 4, y = height * i / 4; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); } }
  if (s.showMargins) { const mx = Math.min(s.marginX, width / 2 - 1), my = Math.min(s.marginY, height / 2 - 1); context.strokeStyle = 'rgba(255,255,255,.42)'; context.setLineDash([6, 6]); context.strokeRect(mx, my, Math.max(1, width - mx * 2), Math.max(1, height - my * 2)); context.setLineDash([]); } context.restore();
}
function renderFrame(t, targetCtx = ctx, width = canvas.width, height = canvas.height, options = {}) {
  const s = renderState(), scaleX = width / s.canvasWidth, scaleY = height / s.canvasHeight; targetCtx.save(); targetCtx.clearRect(0, 0, width, height); targetCtx.scale(scaleX, scaleY); const baseW = s.canvasWidth, baseH = s.canvasHeight;
  if (!options.transparent) { targetCtx.fillStyle = s.bgColor; targetCtx.fillRect(0, 0, baseW, baseH); }
  const textState = resolvedTextState(targetCtx, s, baseW), layout = lockupLayout(targetCtx, textState, baseW, baseH), logoMotion = lifecycleState(rangeProgress(t, s.logoStart, s.logoEnd), s, s.logoTravel, s.logoScale);
  if (logoImage && logoMotion.alpha > .001) { targetCtx.save(); targetCtx.globalAlpha = clamp(logoMotion.alpha, 0, 1); targetCtx.translate(layout.logoX + logoMotion.x, layout.logoY + logoMotion.y); targetCtx.scale(logoMotion.scale, logoMotion.scale); targetCtx.drawImage(logoImage, -layout.logoW / 2, -layout.logoH / 2, layout.logoW, layout.logoH); targetCtx.restore(); }
  const words = textWordLayout(targetCtx, textState.headline, textState); let wordX = textState.textAlign === 'left' ? layout.textX : textState.textAlign === 'right' ? layout.textX - words.totalWidth : layout.textX - words.totalWidth / 2;
  words.words.forEach((word, i) => { const motion = lifecycleState(rangeProgress(t, s.textStart, s.textEnd), s, s.textTravel, s.textScale, i, words.words.length); targetCtx.save(); targetCtx.globalAlpha = clamp(motion.alpha, 0, 1); targetCtx.fillStyle = textState.textColor; const center = wordX + words.widths[i] / 2; targetCtx.translate(center + motion.x, layout.textY + motion.y); targetCtx.scale(motion.scale, motion.scale); targetCtx.translate(-center, -layout.textY); drawWord(targetCtx, word, wordX, layout.textY, textState); targetCtx.restore(); wordX += words.widths[i] + words.space; });
  if (!options.hideGuides) drawGuides(targetCtx, s, baseW, baseH); targetCtx.restore();
}

function aspectFromSvg(svgText) { const match = svgText.match(/viewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)["']/i); if (!match) return null; const w = Number(match[1]), h = Number(match[2]); return w > 0 && h > 0 ? h / w : null; }
function colorizeSvg(svgText, color) { const style = `<style>path,rect,circle,polygon,ellipse{fill:${color} !important;}</style>`; return svgText.replace(/<svg([^>]*)>/i, (m) => `${m}${style}`); }
async function loadBuiltInLogo(type = model.logoType) {
  if (type === 'custom') { if (customLogo) logoImage = customLogo; renderFrame(playhead); return; }
  const path = LOGOS[type] || LOGOS.wordmark, token = ++logoLoadToken;
  try { const response = await fetch(path); if (!response.ok) throw new Error(`HTTP ${response.status}`); const sourceSvg = await response.text(), parsedAspect = aspectFromSvg(sourceSvg), svg = colorizeSvg(sourceSvg, model.logoColor), blob = new Blob([svg], { type: 'image/svg+xml' }), url = URL.createObjectURL(blob), image = new Image(); await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; }); if (token !== logoLoadToken) { URL.revokeObjectURL(url); return; } if (logoObjectUrl) URL.revokeObjectURL(logoObjectUrl); logoObjectUrl = url; logoImage = image; logoAspect = parsedAspect || ((image.naturalHeight || image.height || 1) / (image.naturalWidth || image.width || 1)); renderFrame(playhead); }
  catch (error) { ui.status.textContent = `Logo load failed: ${error instanceof Error ? error.message : String(error)}`; }
}
async function loadGoogleFont() {
  const family = model.fontFamily.trim() || 'Anton', token = ++fontLoadToken, encoded = encodeURIComponent(family).replace(/%20/g, '+'); ui.fontStatus.textContent = `Loading ${family}…`; ui.googleFontStylesheet.href = `https://fonts.googleapis.com/css2?family=${encoded}&display=swap`;
  try { if (document.fonts) { await document.fonts.load(`${model.fontWeight} 48px "${family}"`); await document.fonts.ready; } if (token !== fontLoadToken) return; ui.fontStatus.textContent = `${family} loaded from Google Fonts.`; renderFrame(playhead); }
  catch { if (token !== fontLoadToken) return; ui.fontStatus.textContent = `Could not confirm ${family}; browser fallback may be shown.`; renderFrame(playhead); }
}

function applyCanvasSize() { canvas.width = model.canvasWidth; canvas.height = model.canvasHeight; ui.canvasReadout.textContent = `${model.canvasWidth} × ${model.canvasHeight}`; syncViewport(); renderFrame(playhead); }
function syncViewport() {
  const zoom = model.viewportZoom; ui.viewportZoom.value = String(zoom); ui.fitBtn.classList.toggle('active', zoom === 'fit');
  if (zoom === 'fit') { canvas.style.width = ''; canvas.style.height = ''; canvas.style.maxWidth = ''; canvas.style.maxHeight = ''; ui.stageShell.classList.remove('manual-zoom'); }
  else { const z = clamp(num(zoom, 1), .25, 2); canvas.style.width = `${model.canvasWidth * z}px`; canvas.style.height = `${model.canvasHeight * z}px`; canvas.style.maxWidth = 'none'; canvas.style.maxHeight = 'none'; ui.stageShell.classList.add('manual-zoom'); }
  ui.viewportGridBtn.classList.toggle('active', model.showGrid); ui.viewportSafeBtn.classList.toggle('active', model.showMargins);
}
function formatTime(ms, precise = true) { return `${(ms / 1000).toFixed(precise ? 2 : ms >= 10000 ? 1 : 2).replace(/\.00$/, '')}s`; }
function syncRulerInset() { const meta = document.querySelector('.timeline-meta'); const visible = meta && getComputedStyle(meta).display !== 'none'; ui.timelineRuler.style.paddingRight = visible ? `${meta.offsetWidth + 13}px` : '8px'; }
function syncTimeUI() {
  const total = durationMs(); ui.totalTimeReadout.value = `${(total / 1000).toFixed(2)} s`; ui.timelineStatus.textContent = formatTime(total); ui.timelineRuler.innerHTML = [0,.25,.5,.75,1].map((p) => `<span>${formatTime(total * p, false)}</span>`).join(''); syncRulerInset();
  ui.frameEstimate.textContent = String(Math.max(2, Math.min(240, Math.round(total / 1000 * model.fps)))); ui.outputSizeReadout.textContent = `${Math.round(model.canvasWidth * model.exportScale)} × ${Math.round(model.canvasHeight * model.exportScale)}`;
}
function syncLogoPicker() { ui.logoType.value = model.logoType; document.querySelectorAll('[data-logo-type]').forEach((button) => { const on = button.dataset.logoType === model.logoType; button.classList.toggle('active', on); button.setAttribute('aria-checked', String(on)); }); }
function syncCurveUI() { const curve = selectedCurve === 'enter' ? model.enterBezier : model.exitBezier; [ui.x1.value, ui.y1.value, ui.x2.value, ui.y2.value] = curve.map(String); const key = curve.join(','); ui.preset.value = PRESETS[key] ? key : 'custom'; ui.curveTarget.value = selectedCurve; updateCurveViz(); }
function updateCurveViz() {
  const [x1, y1, x2, y2] = selectedCurve === 'enter' ? model.enterBezier : model.exitBezier, left = 20, right = 240, top = 20, bottom = 150, sx = (x) => left + x * (right - left), sy = (y) => bottom - ((y + .25) / 1.5) * (bottom - top), start = [sx(0), sy(0)], p1 = [sx(x1), sy(y1)], p2 = [sx(x2), sy(y2)], end = [sx(1), sy(1)];
  ui.curvePath.setAttribute('d', `M${start[0]} ${start[1]} C${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]} ${end[0]} ${end[1]}`); ui.guide1.setAttribute('d', `M${start[0]} ${start[1]} L${p1[0]} ${p1[1]}`); ui.guide2.setAttribute('d', `M${end[0]} ${end[1]} L${p2[0]} ${p2[1]}`); ui.handle1.setAttribute('cx', p1[0]); ui.handle1.setAttribute('cy', p1[1]); ui.handle2.setAttribute('cx', p2[0]); ui.handle2.setAttribute('cy', p2[1]); const endpoints = ui.curveViz.querySelectorAll('.curve-endpoint'); if (endpoints[1]) endpoints[1].setAttribute('cy', end[1]);
}
function syncTimeline() {
  const total = durationMs(), phases = phaseFractions();
  for (const layer of ['logo','text']) {
    const [start,end] = resolvedRange(layer), bar = ui.timeline.querySelector(`[data-bar="${layer}"]`), ps = bar.querySelectorAll('.phase'); bar.style.left = `${total ? start / total * 100 : 0}%`; bar.style.width = `${total ? (end - start) / total * 100 : 100}%`; ps[0].style.width = `${phases[0]*100}%`; ps[1].style.width = `${phases[1]*100}%`; ps[2].style.width = `${phases[2]*100}%`;
    const enterHandle = bar.querySelector('.phase-handle.enter-end'), exitHandle = bar.querySelector('.phase-handle.exit-start'); enterHandle.style.left = `${phases[0]*100}%`; exitHandle.style.left = `${(phases[0]+phases[1])*100}%`; const editable = model.flowMode === 'in-hold-out' || model.flowMode === 'in-out'; enterHandle.hidden = !editable; exitHandle.hidden = model.flowMode !== 'in-hold-out';
    const startInput=ui[`${layer}Start`],endInput=ui[`${layer}End`]; startInput.max=String(Math.max(0,total-10));endInput.max=String(total);startInput.value=String(Math.round(start));endInput.value=String(Math.round(end));ui[`${layer}TimingLabel`].textContent=`${formatTime(start)}–${formatTime(end)}`;
  }
  updateTimelinePlayhead(); syncTimeUI();
}
function updateTimelinePlayhead() { const track=ui.timeline.querySelector('.timing-track'),line=ui.timeline.querySelector('.timeline-playhead');if(!track||!line)return;const tr=ui.timeline.getBoundingClientRect(),rr=track.getBoundingClientRect();line.style.left=`${rr.left-tr.left+rr.width*playhead}px`; }
function syncFormFromModel() {
  const fields=['headline','fontFamily','fontSize','fontWeight','letterSpacing','wordSpacing','textAlign','textTransform','textColor','position','gap','alignment','verticalAlignment','offsetX','offsetY','logoOffsetX','logoOffsetY','textOffsetX','textOffsetY','logoSize','logoColor','flowMode','enterDuration','holdDuration','exitDuration','enterDirection','exitDirection','logoTravel','textTravel','logoScale','textScale','wordStagger','canvasWidth','canvasHeight','bgColor','marginX','marginY','fps','exportScale','gifColors','playbackRate']; fields.forEach((id)=>{if(ui[id])ui[id].value=String(model[id]);}); ['autoFit','showMargins','showGrid','gifLoop','previewLoop'].forEach((id)=>{if(ui[id])ui[id].checked=Boolean(model[id]);}); ui.wordStaggerOut.value=`${Math.round(model.wordStagger)} ms`;syncLogoPicker();syncCurveUI();
}
function syncAll({reloadFont=false,reloadLogo=false}={}){syncFormFromModel();applyCanvasSize();syncTimeline();syncViewport();renderFrame(playhead);if(reloadFont)loadGoogleFont();if(reloadLogo)loadBuiltInLogo(model.logoType);}

function setPlayButton(){const label=ui.playBtn.querySelector('span');if(label)label.textContent=isPlaying?'Pause':'Play';ui.playBtn.classList.toggle('playing',isPlaying)}
function syncPlayhead(){ui.scrubber.value=String(playhead);ui.timeReadout.value=`${(playhead*durationMs()/1000).toFixed(2)} s`;renderFrame(playhead);updateTimelinePlayhead()}
function pause(){isPlaying=false;if(rafId)cancelAnimationFrame(rafId);rafId=null;playbackOffsetMs=playhead*durationMs();setPlayButton()}
function tick(now){if(!isPlaying)return;const total=durationMs(),elapsed=(now-playbackStartedAt)*model.playbackRate+playbackOffsetMs;if(model.previewLoop&&total>0)playhead=(elapsed%total)/total;else playhead=clamp(elapsed/total,0,1);syncPlayhead();if(!model.previewLoop&&playhead>=1){pause();return}rafId=requestAnimationFrame(tick)}
function play(){if(isPlaying){pause();return}if(playhead>=1)playhead=0;playbackOffsetMs=playhead*durationMs();playbackStartedAt=performance.now();isPlaying=true;setPlayButton();rafId=requestAnimationFrame(tick)}
function restart(){pause();playhead=0;playbackOffsetMs=0;syncPlayhead()}
function stepFrame(direction){pause();const frames=Math.max(2,Math.round(durationMs()/1000*model.fps));playhead=clamp(playhead+direction/Math.max(1,frames-1),0,1);playbackOffsetMs=playhead*durationMs();syncPlayhead()}

function bindModelInput(id,key=id,{number=false,checkbox=false,onInput=null}={}){const el=ui[id];if(!el)return;const update=()=>{model[key]=checkbox?el.checked:number?num(el.value,model[key]):el.value;if(onInput)onInput();else{syncTimeline();renderFrame(playhead)}};el.addEventListener('input',update);el.addEventListener('change',()=>{update();commitHistory()})}
function setupBindings(){
  ['headline','fontFamily','textAlign','textTransform','textColor','position','alignment','verticalAlignment','enterDirection','exitDirection','bgColor'].forEach((id)=>bindModelInput(id));
  ['fontSize','fontWeight','letterSpacing','wordSpacing','gap','offsetX','offsetY','logoOffsetX','logoOffsetY','textOffsetX','textOffsetY','logoSize','logoTravel','textTravel','logoScale','textScale','wordStagger','marginX','marginY','fps'].forEach((id)=>bindModelInput(id,id,{number:true,onInput:()=>{ui.wordStaggerOut.value=`${Math.round(model.wordStagger)} ms`;syncTimeline();renderFrame(playhead)}}));
  ['autoFit','showMargins','showGrid'].forEach((id)=>bindModelInput(id,id,{checkbox:true,onInput:()=>{syncViewport();renderFrame(playhead)}}));
  ['enterDuration','holdDuration','exitDuration'].forEach((id)=>bindModelInput(id,id,{number:true,onInput:()=>{syncTimeline();syncPlayhead()}})); bindModelInput('flowMode','flowMode',{onInput:()=>{syncTimeline();syncPlayhead()}});
  bindModelInput('exportScale','exportScale',{number:true,onInput:syncTimeUI});bindModelInput('gifColors','gifColors',{number:true,onInput:syncTimeUI});bindModelInput('gifLoop','gifLoop',{checkbox:true,onInput:syncTimeUI});bindModelInput('playbackRate','playbackRate',{number:true,onInput:()=>{if(isPlaying){playbackOffsetMs=playhead*durationMs();playbackStartedAt=performance.now()}}});bindModelInput('previewLoop','previewLoop',{checkbox:true});
  ui.fontWeight.addEventListener('change',loadGoogleFont);ui.loadFontBtn.addEventListener('click',()=>{model.fontFamily=ui.fontFamily.value.trim()||'Anton';loadGoogleFont();commitHistory()});ui.fontFamily.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();model.fontFamily=ui.fontFamily.value.trim()||'Anton';loadGoogleFont();commitHistory()}});
  ui.logoColor.addEventListener('input',()=>{model.logoColor=ui.logoColor.value;if(model.logoType!=='custom')loadBuiltInLogo(model.logoType);renderFrame(playhead)});ui.logoColor.addEventListener('change',commitHistory);
  document.querySelectorAll('[data-logo-type]').forEach((button)=>button.addEventListener('click',()=>{model.logoType=button.dataset.logoType;syncLogoPicker();loadBuiltInLogo(model.logoType);commitHistory()}));
  ui.logoFile.addEventListener('change',async()=>{const file=ui.logoFile.files?.[0];if(!file)return;let uploadedAspect=null;if(file.type==='image/svg+xml'||file.name.toLowerCase().endsWith('.svg')){try{uploadedAspect=aspectFromSvg(await file.text())}catch{}}const url=URL.createObjectURL(file),image=new Image();image.onload=()=>{customLogo=image;logoImage=image;logoAspect=uploadedAspect||((image.naturalHeight||image.height||1)/(image.naturalWidth||image.width||1));model.logoType='custom';if(logoObjectUrl)URL.revokeObjectURL(logoObjectUrl);logoObjectUrl=url;syncLogoPicker();renderFrame(playhead);commitHistory()};image.onerror=()=>{URL.revokeObjectURL(url);ui.status.textContent='Could not read that logo file.'};image.src=url});
}

function setupCanvasControls(){
  ui.canvasPreset.addEventListener('change',()=>{const preset=CANVAS_PRESETS[ui.canvasPreset.value];if(!preset)return;[model.canvasWidth,model.canvasHeight]=preset;syncFormFromModel();applyCanvasSize();syncTimeUI();commitHistory()});
  [['canvasWidth','canvasWidth'],['canvasHeight','canvasHeight']].forEach(([id,key])=>{ui[id].addEventListener('change',()=>{model[key]=clamp(Math.round(num(ui[id].value,model[key])),120,4096);ui.canvasPreset.value='custom';applyCanvasSize();syncTimeUI();commitHistory()})});
  ui.fitBtn.addEventListener('click',()=>{model.viewportZoom='fit';syncViewport()});ui.viewportZoom.addEventListener('change',()=>{model.viewportZoom=ui.viewportZoom.value==='fit'?'fit':num(ui.viewportZoom.value,1);syncViewport()});
  ui.viewportGridBtn.addEventListener('click',()=>{model.showGrid=!model.showGrid;ui.showGrid.checked=model.showGrid;syncViewport();renderFrame(playhead);commitHistory()});ui.viewportSafeBtn.addEventListener('click',()=>{model.showMargins=!model.showMargins;ui.showMargins.checked=model.showMargins;syncViewport();renderFrame(playhead);commitHistory()});
}
function setupCurveEditor(){
  ui.curveTarget.addEventListener('change',()=>{selectedCurve=ui.curveTarget.value;syncCurveUI()});ui.preset.addEventListener('change',()=>{if(ui.preset.value==='custom')return;const curve=PRESETS[ui.preset.value];if(!curve)return;model[selectedCurve==='enter'?'enterBezier':'exitBezier']=[...curve];syncCurveUI();renderFrame(playhead);commitHistory()});
  [ui.x1,ui.y1,ui.x2,ui.y2].forEach((el)=>el.addEventListener('input',()=>{model[selectedCurve==='enter'?'enterBezier':'exitBezier']=[clamp(num(ui.x1.value,.05),0,1),num(ui.y1.value,.9),clamp(num(ui.x2.value,.1),0,1),num(ui.y2.value,1)];ui.preset.value='custom';updateCurveViz();renderFrame(playhead)}));[ui.x1,ui.y1,ui.x2,ui.y2].forEach((el)=>el.addEventListener('change',commitHistory));
  const toSvgPoint=(event)=>{const matrix=ui.curveViz.getScreenCTM();if(!matrix)return null;const point=ui.curveViz.createSVGPoint();point.x=event.clientX;point.y=event.clientY;return point.matrixTransform(matrix.inverse())};const begin=(which,event)=>{activeDrag={kind:'curve',which,before:historySnapshot(),pointerId:event.pointerId};event.target.setPointerCapture?.(event.pointerId);event.preventDefault()};ui.handle1.addEventListener('pointerdown',(e)=>begin(1,e));ui.handle2.addEventListener('pointerdown',(e)=>begin(2,e));
  ui.curveViz.addEventListener('pointermove',(event)=>{if(activeDrag?.kind!=='curve')return;const p=toSvgPoint(event);if(!p)return;const x=clamp((p.x-20)/220,0,1),y=clamp(((150-p.y)/130)*1.5-.25,-2,3),curve=[...(selectedCurve==='enter'?model.enterBezier:model.exitBezier)];curve[activeDrag.which===1?0:2]=Number(x.toFixed(2));curve[activeDrag.which===1?1:3]=Number(y.toFixed(2));model[selectedCurve==='enter'?'enterBezier':'exitBezier']=curve;syncCurveUI();renderFrame(playhead)});const end=()=>{if(activeDrag?.kind==='curve'){activeDrag=null;commitHistory()}};ui.curveViz.addEventListener('pointerup',end);ui.curveViz.addEventListener('pointercancel',end);
  [ui.handle1,ui.handle2].forEach((handle,index)=>handle.addEventListener('keydown',(e)=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const key=selectedCurve==='enter'?'enterBezier':'exitBezier',curve=[...model[key]],xi=index?2:0,yi=index?3:1;if(e.key==='ArrowLeft')curve[xi]=clamp(curve[xi]-.01,0,1);if(e.key==='ArrowRight')curve[xi]=clamp(curve[xi]+.01,0,1);if(e.key==='ArrowUp')curve[yi]=clamp(curve[yi]+.05,-2,3);if(e.key==='ArrowDown')curve[yi]=clamp(curve[yi]-.05,-2,3);model[key]=curve;syncCurveUI();renderFrame(playhead);commitHistory()}));
}

function setupTimeline(){
  const setLayerRange=(layer,start,end)=>{const total=durationMs();model[`${layer}Start`]=clamp(start,0,Math.max(0,total-10));model[`${layer}EndPinned`]=end>=total-1;model[`${layer}End`]=model[`${layer}EndPinned`]?total:clamp(end,model[`${layer}Start`]+10,total);syncTimeline();renderFrame(playhead)};
  for(const layer of ['logo','text']){const start=ui[`${layer}Start`],end=ui[`${layer}End`];start.addEventListener('input',()=>setLayerRange(layer,num(start.value,0),resolvedRange(layer)[1]));end.addEventListener('input',()=>setLayerRange(layer,resolvedRange(layer)[0],num(end.value,durationMs())));start.addEventListener('change',commitHistory);end.addEventListener('change',commitHistory)}
  ui.timeline.addEventListener('pointerdown',(event)=>{const phaseHandle=event.target.closest('.phase-handle'),handle=event.target.closest('.timing-handle'),bar=event.target.closest('.timing-bar'),track=event.target.closest('.timing-track');if(!bar&&!track)return;const layer=bar?.dataset.bar||track?.dataset.track,timingTrack=ui.timeline.querySelector(`[data-track="${layer}"]`),rect=timingTrack.getBoundingClientRect(),[start,end]=resolvedRange(layer);activeDrag={kind:phaseHandle?'phase':handle?(handle.classList.contains('start')?'start':'end'):bar?'bar':'scrub',layer,rect,x0:event.clientX,start0:start,end0:end,before:historySnapshot(),pointerId:event.pointerId,phase:phaseHandle?.classList.contains('enter-end')?'enter':'exit'};(bar||track).setPointerCapture?.(event.pointerId);event.preventDefault();if(activeDrag.kind==='scrub'){playhead=clamp((event.clientX-rect.left)/Math.max(1,rect.width),0,1);pause();syncPlayhead()}});
  ui.timeline.addEventListener('pointermove',(event)=>{if(!activeDrag||!['start','end','bar','scrub','phase'].includes(activeDrag.kind))return;const total=durationMs(),dx=(event.clientX-activeDrag.x0)/Math.max(1,activeDrag.rect.width)*total;if(activeDrag.kind==='scrub'){playhead=clamp((event.clientX-activeDrag.rect.left)/Math.max(1,activeDrag.rect.width),0,1);syncPlayhead();return}if(activeDrag.kind==='phase'){const bar=ui.timeline.querySelector(`[data-bar="${activeDrag.layer}"]`),br=bar.getBoundingClientRect(),frac=clamp((event.clientX-br.left)/Math.max(1,br.width),0,1),phaseTotal=durationMs();if(model.flowMode==='in-out'){model.enterDuration=clamp(Math.round(frac*phaseTotal),50,phaseTotal-50);model.exitDuration=phaseTotal-model.enterDuration;model.holdDuration=0}else if(model.flowMode==='in-hold-out'&&activeDrag.phase==='enter'){model.enterDuration=clamp(Math.round(frac*phaseTotal),50,phaseTotal-model.exitDuration);model.holdDuration=Math.max(0,phaseTotal-model.enterDuration-model.exitDuration)}else if(model.flowMode==='in-hold-out'){const exitStart=clamp(Math.round(frac*phaseTotal),model.enterDuration,phaseTotal-50);model.holdDuration=exitStart-model.enterDuration;model.exitDuration=phaseTotal-exitStart}syncFormFromModel();syncTimeline();renderFrame(playhead);return}let start=activeDrag.start0,end=activeDrag.end0;if(activeDrag.kind==='start')start=clamp(activeDrag.start0+dx,0,end-10);else if(activeDrag.kind==='end')end=clamp(activeDrag.end0+dx,start+10,total);else{const len=activeDrag.end0-activeDrag.start0;start=clamp(activeDrag.start0+dx,0,total-len);end=start+len}setLayerRange(activeDrag.layer,start,end)});
  const stop=()=>{if(activeDrag&&['start','end','bar','scrub','phase'].includes(activeDrag.kind)){const wasScrub=activeDrag.kind==='scrub';activeDrag=null;if(!wasScrub)commitHistory()}};ui.timeline.addEventListener('pointerup',stop);ui.timeline.addEventListener('pointercancel',stop);
  ui.timelineRuler.addEventListener('pointerdown',(event)=>{const track=ui.timeline.querySelector('.timing-track');if(!track)return;const rect=track.getBoundingClientRect();pause();playhead=clamp((event.clientX-rect.left)/Math.max(1,rect.width),0,1);syncPlayhead()});
}
function setupTabsAndLayers(){const titles={typography:'Type',lockup:'Lockup',logo:'Logo',motion:'Motion',canvas:'Canvas',export:'Export'};document.querySelectorAll('.tab').forEach((tab)=>tab.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach((x)=>x.classList.toggle('active',x===tab));document.querySelectorAll('.tab-panel').forEach((panel)=>panel.classList.toggle('active',panel.dataset.panel===tab.dataset.tab));ui.inspectorTitle.textContent=titles[tab.dataset.tab]||'Inspector'}));const layerTabs={lockup:'lockup',logo:'logo',text:'typography',background:'canvas'};document.querySelectorAll('[data-select-layer]').forEach((row)=>row.addEventListener('click',()=>{selectedLayer=row.dataset.selectLayer;document.querySelectorAll('[data-select-layer]').forEach((x)=>x.classList.toggle('selected',x===row));document.querySelector(`.tab[data-tab="${layerTabs[selectedLayer]}"]`)?.click()}))}

async function exportGif(){const totalFrames=Math.max(2,Math.min(240,Math.round(durationMs()/1000*model.fps))),delay=Math.round(1000/model.fps),scale=model.exportScale;ui.exportBtn.disabled=true;ui.topExportBtn.disabled=true;ui.exportProgress.value=0;ui.status.textContent='Loading GIF encoder…';try{const{GIFEncoder,quantize,applyPalette}=await import('https://unpkg.com/gifenc@1.0.3?module');const out=document.createElement('canvas');out.width=Math.round(model.canvasWidth*scale);out.height=Math.round(model.canvasHeight*scale);const outCtx=out.getContext('2d',{willReadFrequently:true}),gif=GIFEncoder();for(let i=0;i<totalFrames;i++){const t=i/(totalFrames-1);renderFrame(t,outCtx,out.width,out.height,{hideGuides:true});const rgba=outCtx.getImageData(0,0,out.width,out.height).data,palette=quantize(rgba,model.gifColors,{format:'rgb565'}),indexed=applyPalette(rgba,palette,'rgb565');gif.writeFrame(indexed,out.width,out.height,{palette,delay,repeat:model.gifLoop?0:-1});ui.exportProgress.value=(i+1)/totalFrames;ui.status.textContent=`Encoding ${i+1} / ${totalFrames}…`;if(i%3===0)await new Promise((r)=>setTimeout(r,0))}gif.finish();const blob=new Blob([gif.bytes()],{type:'image/gif'});downloadBlob(blob,`anim-${model.canvasWidth}x${model.canvasHeight}.gif`);ui.status.textContent=`Done — ${(blob.size/1024/1024).toFixed(1)} MB GIF.`}catch(error){console.error(error);ui.status.textContent=`Export failed: ${error instanceof Error?error.message:String(error)}`}finally{ui.exportBtn.disabled=false;ui.topExportBtn.disabled=false}}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200)}
function exportPng(){const scale=model.exportScale,out=document.createElement('canvas');out.width=Math.round(model.canvasWidth*scale);out.height=Math.round(model.canvasHeight*scale);const outCtx=out.getContext('2d');renderFrame(playhead,outCtx,out.width,out.height,{hideGuides:true});out.toBlob((blob)=>{if(blob)downloadBlob(blob,`anim-frame-${model.canvasWidth}x${model.canvasHeight}.png`)},'image/png')}
function resetDefaults(){model=clone(DEFAULT_MODEL);selectedCurve='enter';selectedLayer='lockup';customLogo=null;ui.logoFile.value='';ui.canvasPreset.value='custom';playhead=0;syncAll({reloadFont:true,reloadLogo:true});commitHistory()}
function cancelActiveDrag(){if(!activeDrag)return;const before=activeDrag.before;activeDrag=null;if(before){model=JSON.parse(before);syncAll()}}
function setupCommands(){
  ui.playBtn.addEventListener('click',play);ui.restartBtn.addEventListener('click',restart);ui.prevFrameBtn.addEventListener('click',()=>stepFrame(-1));ui.nextFrameBtn.addEventListener('click',()=>stepFrame(1));ui.scrubber.addEventListener('input',()=>{pause();playhead=clamp(num(ui.scrubber.value,0),0,1);playbackOffsetMs=playhead*durationMs();syncPlayhead()});
  ui.exportBtn.addEventListener('click',exportGif);ui.topExportBtn.addEventListener('click',()=>{document.querySelector('.tab[data-tab="export"]')?.click();exportGif()});ui.pngBtn.addEventListener('click',exportPng);ui.resetBtn.addEventListener('click',resetDefaults);ui.undoBtn.addEventListener('click',undo);ui.redoBtn.addEventListener('click',redo);
  window.addEventListener('resize',()=>{updateTimelinePlayhead();syncRulerInset();if(model.viewportZoom==='fit')syncViewport()});window.addEventListener('keydown',(e)=>{const editable=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);if(e.key==='Escape'&&activeDrag){e.preventDefault();cancelActiveDrag();return}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();return}if(e.code==='Space'&&!editable){e.preventDefault();play()}if(e.key==='ArrowLeft'&&!editable){e.preventDefault();stepFrame(-1)}if(e.key==='ArrowRight'&&!editable){e.preventDefault();stepFrame(1)}});
}
async function initialize(){setupBindings();setupCanvasControls();setupCurveEditor();setupTimeline();setupTabsAndLayers();setupCommands();syncAll();syncHistoryButtons();await loadBuiltInLogo('wordmark');loadGoogleFont();syncPlayhead();if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)setTimeout(play,120)}
initialize();