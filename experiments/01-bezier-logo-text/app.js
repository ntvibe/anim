const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const STORAGE_KEY = 'anim-studio:experiment-01:v6';
const LEGACY_STORAGE_KEY = 'anim-studio:experiment-01:v5';
const BUILTIN_ASSETS = {
  wordmark: './assets/logos/wordmark.svg',
  combination: './assets/logos/combination.svg',
  stacked: './assets/logos/stacked.svg',
  lettermark: './assets/logos/lettermark.svg',
};
const BUILTIN_CURVES = {
  snappy: { name: 'Snappy', curve: [0.05, 0.9, 0.1, 1] },
  fast: { name: 'Fast Out', curve: [0.22, 1, 0.36, 1] },
  expo: { name: 'Expo Out', curve: [0.16, 1, 0.3, 1] },
  smooth: { name: 'Ease In Out', curve: [0.65, 0, 0.35, 1] },
  back: { name: 'Back', curve: [0.34, 1.56, 0.64, 1] },
};
const CANVAS_PRESETS = {
  custom: null,
  '1:1': [1080, 1080],
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '4:5': [1080, 1350],
  '4:3': [1200, 900],
  banner: [1200, 400],
};
const REVEAL_PRESETS = {
  smooth: { enter: 700, hold: 600, exit: 650, travel: 40, scaleFrom: .96, enterCurve: 'fast', exitCurve: 'smooth' },
  snappy: { enter: 450, hold: 250, exit: 400, travel: 65, scaleFrom: .90, enterCurve: 'expo', exitCurve: 'smooth' },
  soft: { enter: 950, hold: 800, exit: 850, travel: 28, scaleFrom: .98, enterCurve: 'fast', exitCurve: 'smooth' },
  pop: { enter: 600, hold: 450, exit: 550, travel: 30, scaleFrom: .82, enterCurve: 'back', exitCurve: 'fast' },
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const rad = (deg) => deg * Math.PI / 180;
const deg = (r) => r * 180 / Math.PI;
const curvesEqual = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === 4 && b.length === 4 && a.every((n, i) => Math.abs(Number(n) - Number(b[i])) < .0001);

function transform(x = 0, y = 0, scale = 1, rotation = 0, opacity = 1) {
  return { x, y, scale, rotation, opacity };
}
function transformClip(base, enabled = false) {
  return { enabled, start: 0, duration: 850, from: clone(base), to: clone(base), curve: [...BUILTIN_CURVES.snappy.curve] };
}
function revealDefaults(type) {
  return {
    enabled: type !== 'null', start: type === 'text' ? 120 : 0,
    enter: 850, hold: 350, exit: 750,
    enterDirection: 'from-bottom', exitDirection: 'to-top', travel: 50,
    scaleFrom: type === 'text' ? .96 : .94, stagger: type === 'text' ? 35 : 0, staggerOrder: 'forward', staggerPhase: 'enter',
    enterBezier: [...BUILTIN_CURVES.snappy.curve], exitBezier: [0.85, 0, 1, 0.2],
  };
}
function textLayer(id, index, model) {
  const base = transform(model.canvasWidth / 2, model.canvasHeight / 2 + 50, 1, 0, 1);
  return {
    id, type: 'text', name: `Text ${index}`, parentId: null, base,
    content: { text: index === 1 ? 'MORGEN MACHT MAN HEUTE.' : 'NEW TEXT', fontFamily: 'Anton', fontSize: 52, fontWeight: 400, letterSpacing: 2, color: '#ffffff', align: 'center', maxWidth: Math.round(model.canvasWidth * .8), autoFit: true },
    reveal: revealDefaults('text'), transform: transformClip(base, false),
  };
}
function imageLayer(id, index, model) {
  const base = transform(model.canvasWidth / 2, model.canvasHeight / 2 - 42, 1, 0, 1);
  return {
    id, type: 'image', name: index === 1 ? 'Logo' : `Image ${index}`, parentId: null, base,
    content: { assetKind: 'wordmark', src: BUILTIN_ASSETS.wordmark, width: 220, tint: '#ffffff', fileName: '' },
    reveal: revealDefaults('image'), transform: transformClip(base, false),
  };
}
function nullLayer(id, index, model) {
  const base = transform(model.canvasWidth / 2, model.canvasHeight / 2, 1, 0, 1);
  return { id, type: 'null', name: `Null ${index}`, parentId: null, base, reveal: revealDefaults('null'), transform: transformClip(base, true) };
}
function defaultModel() {
  const model = {
    canvasWidth: 800, canvasHeight: 450, bgColor: '#103e36', showGrid: false, showMargins: true, marginX: 60, marginY: 40,
    fps: 30, playbackRate: 1, previewLoop: true, snap: true, exportScale: 1, gifColors: 256, gifLoop: true,
    curvePresets: {}, counters: { text: 2, image: 2, null: 1 }, layerOrder: [], layers: {},
  };
  const image = imageLayer('image-1', 1, model);
  const text = textLayer('text-1', 1, model);
  model.layers[image.id] = image; model.layers[text.id] = text;
  model.layerOrder = [image.id, text.id];
  return model;
}

let model = defaultModel();
let selectedLayerId = 'image-1';
let selectedCurveTarget = 'transform';
let playhead = 0;
let isPlaying = false;
let rafId = null;
let playbackStartedAt = 0;
let playbackOffsetMs = 0;
let activeDrag = null;
let history = [JSON.stringify(model)];
let historyIndex = 0;
let saveTimer = null;
const imageCache = new Map();
const objectUrls = new Set();

function layerIds() { return model.layerOrder.filter((id) => model.layers[id]); }
function selectedLayer() { return model.layers[selectedLayerId] || model.layers[layerIds()[0]]; }
function isVisual(layer) { return layer?.type === 'text' || layer?.type === 'image'; }
function textWordCount(layer) { return layer?.type === 'text' ? Math.max(1, layer.content?.text?.trim().split(/\s+/).filter(Boolean).length || 1) : 1; }
function staggerSpan(layer) {
  if (layer?.type !== 'text') return 0;
  const r = layer.reveal, count = textWordCount(layer);
  return Math.max(0, count - 1) * Math.max(0, Number(r.stagger) || 0);
}
function revealDuration(layer) {
  if (!isVisual(layer) || !layer.reveal.enabled) return 0;
  const r = layer.reveal, span = staggerSpan(layer), phase = r.staggerPhase || 'enter';
  const enterSpan = layer.type === 'text' && (phase === 'enter' || phase === 'both') ? span : 0;
  const exitSpan = layer.type === 'text' && (phase === 'exit' || phase === 'both') ? span : 0;
  return Math.max(1, r.enter + enterSpan + r.hold + r.exit + exitSpan);
}
function revealEnd(layer) { return isVisual(layer) && layer.reveal.enabled ? layer.reveal.start + revealDuration(layer) : 0; }
function transformEnd(layer) { return layer.transform.enabled ? layer.transform.start + Math.max(1, layer.transform.duration) : 0; }
function durationMs() { return Math.max(500, ...layerIds().map((id) => Math.max(revealEnd(model.layers[id]), transformEnd(model.layers[id])))); }
function frameMs() { return 1000 / Math.max(1, model.fps); }
function snapMs(ms) { return model.snap ? Math.round(ms / frameMs()) * frameMs() : ms; }
function formatTime(ms) { return `${(ms / 1000).toFixed(2).replace(/\.00$/, '')}s`; }

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

function matFromTransform(t) {
  const r = rad(t.rotation), c = Math.cos(r) * t.scale, s = Math.sin(r) * t.scale;
  return [c, s, -s, c, t.x, t.y];
}
function matMul(a, b) {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
function matInv(m) {
  const det = m[0]*m[3]-m[1]*m[2]; if (Math.abs(det) < 1e-9) return [1,0,0,1,0,0];
  const inv = 1/det; return [m[3]*inv, -m[1]*inv, -m[2]*inv, m[0]*inv, (m[2]*m[5]-m[3]*m[4])*inv, (m[1]*m[4]-m[0]*m[5])*inv];
}
function decompose(m, opacity = 1) {
  const scale = Math.sqrt(m[0]*m[0] + m[1]*m[1]);
  return { x: m[4], y: m[5], scale, rotation: deg(Math.atan2(m[1], m[0])), opacity };
}
function interpolateTransform(a, b, t) {
  return { x: lerp(a.x,b.x,t), y: lerp(a.y,b.y,t), scale: lerp(a.scale,b.scale,t), rotation: lerp(a.rotation,b.rotation,t), opacity: lerp(a.opacity,b.opacity,t) };
}
function localTransformAt(layer, ms) {
  const p = layer.transform;
  if (!p.enabled) return clone(layer.base);
  const start = Math.max(0, p.start), duration = Math.max(1, p.duration);
  if (ms <= start) return clone(p.from);
  if (ms >= start + duration) return clone(p.to);
  const e = cubicBezierEase(clamp((ms - start) / duration, 0, 1), ...p.curve);
  return interpolateTransform(p.from, p.to, e);
}
function parentBindMs(layer) {
  return layer?.parentBindMs == null ? null : Math.max(0, num(layer.parentBindMs, 0));
}
function worldMatrix(layerId, ms, seen = new Set()) {
  const layer = model.layers[layerId]; if (!layer || seen.has(layerId)) return [1,0,0,1,0,0];
  seen.add(layerId);
  const local = matFromTransform(localTransformAt(layer, ms));
  if (!layer.parentId || !model.layers[layer.parentId]) return local;
  const bind = parentBindMs(layer);
  // Legacy parent relationships without a bind frame keep their old direct-parent behavior.
  if (bind == null) return matMul(worldMatrix(layer.parentId, ms, new Set(seen)), local);
  // AE-style bind pose: the relationship is active across the whole timeline, but the
  // parent's transform at the frame where parenting happened is treated as identity.
  const parentNow = worldMatrix(layer.parentId, ms, new Set(seen));
  const parentAtBind = worldMatrix(layer.parentId, bind, new Set(seen));
  return matMul(matMul(parentNow, matInv(parentAtBind)), local);
}
function worldOpacity(layerId, ms, seen = new Set()) {
  const layer = model.layers[layerId]; if (!layer || seen.has(layerId)) return 1;
  seen.add(layerId);
  const own = localTransformAt(layer, ms).opacity;
  if (!layer.parentId || !model.layers[layer.parentId]) return own;
  const bind = parentBindMs(layer);
  if (bind == null) return own * worldOpacity(layer.parentId, ms, new Set(seen));
  const parentNow = worldOpacity(layer.parentId, ms, new Set(seen));
  const parentAtBind = worldOpacity(layer.parentId, bind, new Set(seen));
  const parentFactor = parentAtBind > 1e-6 ? parentNow / parentAtBind : 1;
  return own * parentFactor;
}
function parentInfluenceAt(layer, ms) {
  if (!layer.parentId || !model.layers[layer.parentId]) return { matrix: [1,0,0,1,0,0], opacity: 1 };
  const bind = parentBindMs(layer);
  if (bind == null) return { matrix: worldMatrix(layer.parentId, ms), opacity: worldOpacity(layer.parentId, ms) };
  const parentNow = worldMatrix(layer.parentId, ms);
  const parentAtBind = worldMatrix(layer.parentId, bind);
  const opacityNow = worldOpacity(layer.parentId, ms);
  const opacityAtBind = worldOpacity(layer.parentId, bind);
  return {
    matrix: matMul(parentNow, matInv(parentAtBind)),
    opacity: opacityAtBind > 1e-6 ? opacityNow / opacityAtBind : 1,
  };
}
function bakeCurrentParentInfluence(layer, ms) {
  const influence = parentInfluenceAt(layer, ms);
  const bake = (value) => decompose(
    matMul(influence.matrix, matFromTransform(value)),
    clamp(value.opacity * influence.opacity, 0, 1)
  );
  layer.base = bake(layer.base);
  layer.transform.from = bake(layer.transform.from);
  layer.transform.to = bake(layer.transform.to);
}
function reparentLayer(layerId, newParentId) {
  const layer = model.layers[layerId]; if (!layer) return;
  const nextParentId = newParentId || null;
  if (nextParentId === layer.parentId) return;
  const rawBind = playhead * durationMs();
  const bind = Math.max(0, model.snap ? snapMs(rawBind) : rawBind);
  // If changing/removing an existing parent, first bake its current influence into the
  // child's own transform values so the child does not jump on this frame.
  if (layer.parentId && model.layers[layer.parentId]) bakeCurrentParentInfluence(layer, bind);
  layer.parentId = null;
  layer.parentBindMs = null;
  if (nextParentId && model.layers[nextParentId]) {
    layer.parentId = nextParentId;
    layer.parentBindMs = bind;
  }
}
function wouldCreateCycle(layerId, parentId) {
  let cur = parentId, guard = 0;
  while (cur && guard++ < 100) { if (cur === layerId) return true; cur = model.layers[cur]?.parentId || null; }
  return false;
}

function staggerRank(index, count, order = 'forward') {
  if (count <= 1) return 0;
  if (order === 'reverse') return count - 1 - index;
  if (order === 'center' || order === 'edges') {
    const mid = (count - 1) / 2;
    const ordered = Array.from({ length: count }, (_, i) => i).sort((a, b) => {
      const da = Math.abs(a - mid), db = Math.abs(b - mid);
      return order === 'center' ? (da - db || a - b) : (db - da || a - b);
    });
    return ordered.indexOf(index);
  }
  return index;
}
function revealState(layer, ms, wordIndex = 0, wordCount = 1) {
  if (!isVisual(layer) || !layer.reveal.enabled) return { alpha: 1, x: 0, y: 0, scale: 1 };
  const r = layer.reveal, local = ms - r.start;
  if (local < 0) return { alpha: 0, x: 0, y: 0, scale: r.scaleFrom };
  const isTextStagger = layer.type === 'text' && wordCount > 1 && r.stagger > 0;
  const rank = isTextStagger ? staggerRank(wordIndex, wordCount, r.staggerOrder || 'forward') : 0;
  const amount = isTextStagger ? Math.max(0, Number(r.stagger) || 0) : 0;
  const phase = r.staggerPhase || 'enter';
  const maxSpan = Math.max(0, wordCount - 1) * amount;
  const enterDelay = phase === 'enter' || phase === 'both' ? rank * amount : 0;
  const exitDelay = phase === 'exit' || phase === 'both' ? rank * amount : 0;
  const enterBlockSpan = phase === 'enter' || phase === 'both' ? maxSpan : 0;
  const enterStart = enterDelay, enterEnd = enterStart + r.enter;
  const enterVec = directionVector(r.enterDirection), exitVec = directionVector(r.exitDirection);
  if (local < enterStart) return { alpha: 0, x: enterVec[0]*r.travel, y: enterVec[1]*r.travel, scale: r.scaleFrom };
  if (local < enterEnd) {
    const p = cubicBezierEase(clamp((local-enterStart)/Math.max(1,r.enter),0,1), ...r.enterBezier);
    return { alpha: p, x: enterVec[0]*r.travel*(1-p), y: enterVec[1]*r.travel*(1-p), scale: lerp(r.scaleFrom,1,p) };
  }
  const exitStart = r.enter + enterBlockSpan + r.hold + exitDelay;
  if (local <= exitStart) return { alpha: 1, x: 0, y: 0, scale: 1 };
  const p = cubicBezierEase(clamp((local-exitStart)/Math.max(1,r.exit),0,1), ...r.exitBezier);
  return { alpha: 1-p, x: exitVec[0]*r.travel*p, y: exitVec[1]*r.travel*p, scale: 1 };
}

function drawSpacedText(context, text, letterSpacing, y = 0) {
  const chars = [...text]; const widths = chars.map((ch) => context.measureText(ch).width);
  const total = widths.reduce((a,b)=>a+b,0) + Math.max(0, chars.length-1)*letterSpacing;
  let x = -total/2;
  chars.forEach((ch, i) => { context.fillText(ch, x, y); x += widths[i] + (i < chars.length-1 ? letterSpacing : 0); });
}
function textWidth(context, text, letterSpacing) {
  const chars = [...text]; return chars.reduce((sum, ch) => sum + context.measureText(ch).width, 0) + Math.max(0, chars.length-1)*letterSpacing;
}
function fittedFontSize(context, layer) {
  const c = layer.content; if (!c.autoFit) return c.fontSize;
  let size = c.fontSize;
  while (size > 8) { context.font = `${c.fontWeight} ${size}px "${c.fontFamily}", sans-serif`; if (textWidth(context, c.text, c.letterSpacing) <= c.maxWidth) break; size -= 1; }
  return size;
}
async function ensureFont(layer) {
  if (layer.type !== 'text') return;
  const family = layer.content.fontFamily.trim() || 'Anton';
  let link = document.querySelector(`link[data-font-family="${CSS.escape(family)}"]`);
  if (!link) { link = document.createElement('link'); link.rel = 'stylesheet'; link.dataset.fontFamily = family; link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g,'+')}&display=swap`; document.head.appendChild(link); }
  try { await document.fonts?.load(`${layer.content.fontWeight} 48px "${family}"`); } catch {}
  renderFrame(playhead);
}
function colorizeSvg(svgText, color) { return svgText.replace(/<svg([^>]*)>/i, (m) => `${m}<style>path,rect,circle,polygon,ellipse{fill:${color} !important;}</style>`); }
async function ensureImage(layer) {
  if (layer.type !== 'image') return null;
  const c = layer.content; const cacheKey = `${c.src}|${c.tint}`;
  const existing = imageCache.get(layer.id); if (existing?.key === cacheKey) return existing.image;
  try {
    let src = c.src;
    if (c.assetKind in BUILTIN_ASSETS) {
      const res = await fetch(BUILTIN_ASSETS[c.assetKind]); const svg = await res.text(); const blob = new Blob([colorizeSvg(svg, c.tint)], { type:'image/svg+xml' }); src = URL.createObjectURL(blob); objectUrls.add(src);
    }
    if (!src) return null;
    const image = new Image(); await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=src;});
    imageCache.set(layer.id, { key: cacheKey, image }); renderFrame(playhead); return image;
  } catch { return null; }
}

function drawImageLayer(context, layer, ms) {
  const cached = imageCache.get(layer.id)?.image; if (!cached) { ensureImage(layer); return; }
  const world = worldMatrix(layer.id, ms), reveal = revealState(layer, ms), opacity = worldOpacity(layer.id, ms) * reveal.alpha;
  if (opacity <= .001) return;
  const width = layer.content.width, height = width * (cached.naturalHeight / Math.max(1,cached.naturalWidth));
  context.save(); context.globalAlpha = clamp(opacity,0,1); context.transform(...world); context.translate(reveal.x,reveal.y); context.scale(reveal.scale,reveal.scale); context.drawImage(cached,-width/2,-height/2,width,height); context.restore();
}
function drawTextLayer(context, layer, ms) {
  const c = layer.content, size = fittedFontSize(context, layer); context.font = `${c.fontWeight} ${size}px "${c.fontFamily}", sans-serif`; context.textBaseline='middle'; context.textAlign='left'; context.fillStyle=c.color;
  const words = c.text.split(/\s+/).filter(Boolean); const wordWidths = words.map(w => textWidth(context,w,c.letterSpacing)); const space = context.measureText(' ').width + c.letterSpacing; const totalWidth = wordWidths.reduce((a,b)=>a+b,0)+Math.max(0,words.length-1)*space; let cursor = -totalWidth/2;
  const world = worldMatrix(layer.id, ms), parentOpacity = worldOpacity(layer.id, ms);
  words.forEach((word,i)=>{const reveal=revealState(layer,ms,i,words.length);if(reveal.alpha>.001){const center=cursor+wordWidths[i]/2;context.save();context.globalAlpha=clamp(parentOpacity*reveal.alpha,0,1);context.transform(...world);context.translate(center+reveal.x,reveal.y);context.scale(reveal.scale,reveal.scale);drawSpacedText(context,word,c.letterSpacing,0);context.restore();}cursor+=wordWidths[i]+space;});
}
function drawGuides(context) {
  context.save();
  if (model.showGrid) { context.strokeStyle='rgba(255,255,255,.12)';context.lineWidth=1;for(let i=1;i<4;i++){const x=model.canvasWidth*i/4,y=model.canvasHeight*i/4;context.beginPath();context.moveTo(x,0);context.lineTo(x,model.canvasHeight);context.stroke();context.beginPath();context.moveTo(0,y);context.lineTo(model.canvasWidth,y);context.stroke();} }
  if (model.showMargins) { const mx=Math.min(model.marginX,model.canvasWidth/2-1),my=Math.min(model.marginY,model.canvasHeight/2-1);context.strokeStyle='rgba(255,255,255,.42)';context.setLineDash([6,6]);context.strokeRect(mx,my,model.canvasWidth-mx*2,model.canvasHeight-my*2);context.setLineDash([]); }
  context.restore();
}
function drawSelectedNull(context, ms) {
  const layer=selectedLayer(); if (!layer || layer.type!=='null') return; const m=worldMatrix(layer.id,ms); const x=m[4],y=m[5];context.save();context.translate(x,y);context.strokeStyle='rgba(47,120,255,.9)';context.lineWidth=1.5;context.beginPath();context.moveTo(-10,0);context.lineTo(10,0);context.moveTo(0,-10);context.lineTo(0,10);context.stroke();context.strokeRect(-4,-4,8,8);context.restore();
}
function renderFrame(t, targetCtx = ctx, width = canvas.width, height = canvas.height, options = {}) {
  const ms = clamp(t,0,1)*durationMs(); targetCtx.save();targetCtx.clearRect(0,0,width,height);targetCtx.scale(width/model.canvasWidth,height/model.canvasHeight);targetCtx.fillStyle=model.bgColor;targetCtx.fillRect(0,0,model.canvasWidth,model.canvasHeight);
  layerIds().forEach((id)=>{const layer=model.layers[id];if(layer.type==='image')drawImageLayer(targetCtx,layer,ms);else if(layer.type==='text')drawTextLayer(targetCtx,layer,ms);});
  if (!options.hideGuides) { drawGuides(targetCtx); drawSelectedNull(targetCtx,ms); } targetCtx.restore();
}

function normalizeLayer(layer, modelRef) {
  const base = transform(modelRef.canvasWidth/2,modelRef.canvasHeight/2,1,0,1);
  const bindMs = layer.parentBindMs ?? layer.parentStartMs ?? null; const out = { ...layer, parentId: layer.parentId || null, parentBindMs: bindMs == null ? null : Math.max(0, num(bindMs, 0)), base: { ...base, ...(layer.base||{}) } }; delete out.parentStartMs;
  out.reveal = { ...revealDefaults(layer.type), ...(layer.reveal||{}) };
  out.transform = { ...transformClip(out.base,false), ...(layer.transform||{}), from:{...out.base,...(layer.transform?.from||{})},to:{...out.base,...(layer.transform?.to||{})},curve:Array.isArray(layer.transform?.curve)?layer.transform.curve.map(Number):[...BUILTIN_CURVES.snappy.curve] };
  if (layer.type==='text') out.content={text:'NEW TEXT',fontFamily:'Anton',fontSize:52,fontWeight:400,letterSpacing:2,color:'#fff',align:'center',maxWidth:Math.round(modelRef.canvasWidth*.8),autoFit:true,...(layer.content||{})};
  if (layer.type==='image') out.content={assetKind:'wordmark',src:BUILTIN_ASSETS.wordmark,width:220,tint:'#fff',fileName:'',...(layer.content||{})};
  return out;
}
function migrateV5(old) {
  const next = defaultModel(); next.curvePresets = clone(old.curvePresets||{}); next.canvasWidth=old.canvasWidth||800;next.canvasHeight=old.canvasHeight||450;next.bgColor=old.bgColor||'#103e36';next.fps=old.fps||30;next.previewLoop=old.previewLoop!==false;next.snap=old.snap!==false;
  const img = imageLayer('image-1',1,next), txt = textLayer('text-1',1,next); img.name=old.layers?.logo?.name||'Logo'; txt.name=old.layers?.text?.name||'Text'; img.content.assetKind=old.logoType&&BUILTIN_ASSETS[old.logoType]?old.logoType:'wordmark';img.content.src=BUILTIN_ASSETS[img.content.assetKind];img.content.width=old.logoSize||220;img.content.tint=old.logoColor||'#fff';txt.content.text=old.headline||txt.content.text;txt.content.fontFamily=old.fontFamily||'Anton';txt.content.fontSize=old.fontSize||52;txt.content.fontWeight=old.fontWeight||400;txt.content.letterSpacing=old.letterSpacing||2;txt.content.color=old.textColor||'#fff';
  const mapLife=(src,dst)=>{if(!src)return;dst.reveal.enabled=true;dst.reveal.start=src.start||0;dst.reveal.enter=src.enter||850;dst.reveal.hold=src.hold||350;dst.reveal.exit=src.exit||750;dst.reveal.enterDirection=src.enterDirection||'from-bottom';dst.reveal.exitDirection=src.exitDirection||'to-top';dst.reveal.travel=src.travel||50;dst.reveal.scaleFrom=src.scale||.95;dst.reveal.stagger=src.stagger||0;dst.reveal.enterBezier=src.enterBezier||dst.reveal.enterBezier;dst.reveal.exitBezier=src.exitBezier||dst.reveal.exitBezier;if(src.position){dst.transform.enabled=!!src.position.enabled;dst.transform.start=src.position.start||0;dst.transform.duration=src.position.duration||850;dst.transform.from={...dst.base,x:dst.base.x+(src.position.from?.x||0),y:dst.base.y+(src.position.from?.y||0)};dst.transform.to={...dst.base,x:dst.base.x+(src.position.to?.x||0),y:dst.base.y+(src.position.to?.y||0)};dst.transform.curve=src.position.curve||dst.transform.curve;}};
  mapLife(old.layers?.logo,img);mapLife(old.layers?.text,txt); next.layers={ [img.id]:img,[txt.id]:txt };next.layerOrder=[img.id,txt.id];
  Object.entries(old.layers||{}).filter(([id,l])=>l.type==='null').forEach(([id,l],i)=>{const n=nullLayer(id,i+1,next);n.name=l.name||`Null ${i+1}`;if(l.position){n.transform.enabled=true;n.transform.start=l.position.start||0;n.transform.duration=l.position.duration||850;n.transform.from={...n.base,x:n.base.x+(l.position.from?.x||0),y:n.base.y+(l.position.from?.y||0)};n.transform.to={...n.base,x:n.base.x+(l.position.to?.x||0),y:n.base.y+(l.position.to?.y||0)};n.transform.curve=l.position.curve||n.transform.curve;}next.layers[id]=n;next.layerOrder.unshift(id);});
  const remap={logo:'image-1',text:'text-1'};Object.entries(old.layers||{}).forEach(([id,l])=>{const target=next.layers[remap[id]||id];if(target&&l.parentId)target.parentId=remap[l.parentId]||l.parentId;}); next.counters.null=Object.values(next.layers).filter(l=>l.type==='null').length+1;return next;
}
function normalizeModel(input) {
  if (!input || typeof input!=='object') return defaultModel();
  if (input.layers?.logo || input.layers?.text) return migrateV5(input);
  const base=defaultModel(), next={...base,...input,counters:{...base.counters,...(input.counters||{})},curvePresets:{...(input.curvePresets||{})},layers:{},layerOrder:[]};Object.entries(input.layers||{}).forEach(([id,l])=>{next.layers[id]=normalizeLayer({...l,id},next);});(input.layerOrder||Object.keys(next.layers)).forEach(id=>{if(next.layers[id]&&!next.layerOrder.includes(id))next.layerOrder.push(id);});Object.keys(next.layers).forEach(id=>{if(!next.layerOrder.includes(id))next.layerOrder.push(id);});if(!next.layerOrder.length)return base;return next;
}

function snapshot(){return JSON.stringify(model);}
function syncHistoryButtons(){$('undoBtn').disabled=historyIndex<=0;$('redoBtn').disabled=historyIndex>=history.length-1;}
function commitHistory(){const s=snapshot();if(history[historyIndex]===s){scheduleSave();return;}history=history.slice(0,historyIndex+1);history.push(s);if(history.length>80)history.shift();historyIndex=history.length-1;syncHistoryButtons();scheduleSave();}
function restoreHistory(index){if(index<0||index>=history.length)return;historyIndex=index;model=normalizeModel(JSON.parse(history[index]));if(!model.layers[selectedLayerId])selectedLayerId=layerIds()[0];syncAll({loadAssets:true});syncHistoryButtons();scheduleSave();}
function undo(){restoreHistory(historyIndex-1);}function redo(){restoreHistory(historyIndex+1);}
function scheduleSave(){const el=$('saveStatus');el.textContent='Saving…';clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,320);}
function safeForStorage(){const safe=clone(model);Object.values(safe.layers).forEach((l)=>{if(l.type==='image'&&l.content.assetKind==='custom-session'){l.content.src='';l.content.assetKind='wordmark';l.content.fileName='';}});return safe;}
function saveNow(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(safeForStorage()));$('saveStatus').textContent='Autosaved';}catch{$('saveStatus').textContent='Save unavailable';}}
function loadSaved(){for(const key of[STORAGE_KEY,LEGACY_STORAGE_KEY]){try{const raw=localStorage.getItem(key);if(!raw)continue;model=normalizeModel(JSON.parse(raw));return true;}catch{}}return false;}

function layerIcon(type){return type==='text'?'T':type==='image'?'◈':'◇';}
function depthFor(id){let depth=0,cur=model.layers[id]?.parentId,guard=0;while(cur&&model.layers[cur]&&guard++<10){depth++;cur=model.layers[cur].parentId;}return depth;}
function revealBarHtml(layer,total){if(!isVisual(layer)||!layer.reveal.enabled)return'';const r=layer.reveal,dur=revealDuration(layer),left=r.start/total*100,width=Math.max(.4,dur/total*100),p0=r.enter/dur*100,p1=r.hold/dur*100,p2=r.exit/dur*100;return`<div class="reveal-bar" data-reveal-bar="${layer.id}" style="left:${left}%;width:${width}%"><button class="edge-handle start" data-reveal-edge="start" aria-label="Reveal start"></button><div class="phase-strip"><span class="phase enter" style="width:${p0}%"></span><span class="phase hold" style="width:${p1}%"></span><span class="phase exit" style="width:${p2}%"></span></div><button class="phase-handle enter-end" style="left:${p0}%" data-reveal-edge="enter"></button><button class="phase-handle hold-end" style="left:${p0+p1}%" data-reveal-edge="hold"></button><button class="edge-handle end" data-reveal-edge="end" aria-label="Reveal end"></button></div>`;}
function transformBarHtml(layer,total){const p=layer.transform;if(!p.enabled)return'';const left=p.start/total*100,width=Math.max(.4,p.duration/total*100);return`<div class="transform-clip" data-transform-clip="${layer.id}" style="left:${left}%;width:${width}%"><button class="diamond a" data-transform-edge="a" aria-label="A keyframe"></button><span class="transform-line"></span><button class="diamond b" data-transform-edge="b" aria-label="B keyframe"></button></div>`;}
function renderLayerRows(){const total=durationMs();$('layerTree').innerHTML=layerIds().map(id=>{const l=model.layers[id],depth=depthFor(id),parent=l.parentId&&model.layers[l.parentId]?model.layers[l.parentId].name:'';return`<button class="layer-row ${id===selectedLayerId?'selected':''}" data-layer-select="${id}" style="--depth:${depth}"><span class="layer-icon">${layerIcon(l.type)}</span><span class="layer-copy"><strong>${escapeHtml(l.name)}</strong>${parent?`<small>↳ ${escapeHtml(parent)}</small>`:''}</span><span class="layer-type">${l.type}</span></button>`;}).join('');$('timeline').innerHTML=`<div class="timeline-playhead"></div>${layerIds().map(id=>{const l=model.layers[id];return`<div class="timeline-row" data-layer="${id}"><div class="timing-track" data-track="${id}">${revealBarHtml(l,total)}${transformBarHtml(l,total)}</div></div>`;}).join('')}`;}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function syncTimeline(){renderLayerRows();const total=durationMs();$('timelineStatus').textContent=formatTime(total);$('timelineRuler').innerHTML=[0,.25,.5,.75,1].map(p=>`<span>${formatTime(total*p)}</span>`).join('');updateTimelinePlayhead();syncTimeUI();}
function updateTimelinePlayhead(){const track=document.querySelector('.timing-track'),line=document.querySelector('.timeline-playhead');if(!track||!line)return;const tr=$('timeline').getBoundingClientRect(),rr=track.getBoundingClientRect();line.style.left=`${rr.left-tr.left+rr.width*playhead}px`;}
function syncTimeUI(){const total=durationMs();$('timeReadout').textContent=`${(playhead*total/1000).toFixed(2)} s`;$('totalTimeReadout').textContent=`${(total/1000).toFixed(2)} s`;$('frameEstimate').textContent=String(Math.max(2,Math.min(360,Math.round(total/1000*model.fps))));$('outputSizeReadout').textContent=`${Math.round(model.canvasWidth*model.exportScale)} × ${Math.round(model.canvasHeight*model.exportScale)}`;}

function parentOptions(layer){const options=['<option value="">None</option>'];layerIds().forEach(id=>{const candidate=model.layers[id];if(candidate.type!=='null'||id===layer.id||wouldCreateCycle(layer.id,id))return;options.push(`<option value="${id}">${escapeHtml(candidate.name)}</option>`);});return options.join('');}
function syncLayerInspector(){const l=selectedLayer();if(!l)return;$('layerName').value=l.name;$('layerTypeBadge').textContent=l.type;$('layerTypeBadge').className=`type-badge ${l.type}`;$('deleteLayerBtn').disabled=layerIds().length<=1;$('parentLayer').innerHTML=parentOptions(l);$('parentLayer').value=l.parentId||'';const parentHint=$('parentPickupHint');if(parentHint){const pickup=parentBindMs(l);parentHint.hidden=!l.parentId;parentHint.textContent=!l.parentId?'':pickup==null?'Legacy parent relation. Reassign the parent at the desired timeline position to create a bind pose.':`Bound to ${model.layers[l.parentId]?.name||'parent'} at ${formatTime(pickup)}. That frame is the reference pose; parenting applies across the full timeline.`;}
  ['baseX','baseY','baseScale','baseRotation','baseOpacity'].forEach(id=>$(id).disabled=l.transform.enabled);
  $('baseX').value=Math.round(l.base.x*100)/100;$('baseY').value=Math.round(l.base.y*100)/100;$('baseScale').value=l.base.scale;$('baseRotation').value=l.base.rotation;$('baseOpacity').value=l.base.opacity;
  $('textControls').hidden=l.type!=='text';$('imageControls').hidden=l.type!=='image';$('nullHint').hidden=l.type!=='null';
  if(l.type==='text'){const c=l.content;$('textValue').value=c.text;$('fontFamily').value=c.fontFamily;$('fontSize').value=c.fontSize;$('fontWeight').value=c.fontWeight;$('letterSpacing').value=c.letterSpacing;$('textColor').value=c.color;$('textMaxWidth').value=c.maxWidth;$('textAutoFit').checked=c.autoFit;}
  if(l.type==='image'){const c=l.content;$('imageAsset').value=c.assetKind in BUILTIN_ASSETS?c.assetKind:'custom';$('imageWidth').value=c.width;$('imageTint').value=c.tint;$('imageFileName').textContent=c.fileName|| (c.assetKind in BUILTIN_ASSETS?`${c.assetKind}.svg`:'Custom image');}
}
function syncMotionInspector(){const l=selectedLayer();if(!l)return;const r=l.reveal,p=l.transform;$('revealSection').hidden=!isVisual(l);if(isVisual(l)){$('revealEnabled').checked=r.enabled;$('revealStart').value=Math.round(r.start);$('enterDuration').value=Math.round(r.enter);$('holdDuration').value=Math.round(r.hold);$('exitDuration').value=Math.round(r.exit);$('enterDirection').value=r.enterDirection;$('exitDirection').value=r.exitDirection;$('revealTravel').value=r.travel;$('revealScale').value=r.scaleFrom;$('wordStaggerWrap').hidden=l.type!=='text';$('wordStagger').value=r.stagger;$('wordStaggerOut').textContent=`${Math.round(r.stagger)} ms`;$('wordStaggerOrder').value=r.staggerOrder||'forward';$('wordStaggerPhase').value=r.staggerPhase||'enter';}
  $('transformEnabled').checked=p.enabled;$('transformStart').value=Math.round(p.start);$('transformDuration').value=Math.round(p.duration);for(const side of['A','B']){const src=side==='A'?p.from:p.to;$(`pos${side}X`).value=src.x;$(`pos${side}Y`).value=src.y;$(`scale${side}`).value=src.scale;$(`rot${side}`).value=src.rotation;$(`opacity${side}`).value=src.opacity;}
  [...$('curveTarget').options].forEach(o=>{o.disabled=l.type==='null'&&o.value!=='transform';});if(l.type==='null'&&selectedCurveTarget!=='transform')selectedCurveTarget='transform';$('curveTarget').value=selectedCurveTarget;syncCurveUI();}
function currentCurve(){const l=selectedLayer();if(selectedCurveTarget==='transform')return l.transform.curve;if(selectedCurveTarget==='enter')return l.reveal.enterBezier;return l.reveal.exitBezier;}
function setCurrentCurve(curve){const l=selectedLayer(),safe=curve.map(Number);if(selectedCurveTarget==='transform')l.transform.curve=[...safe];else if(selectedCurveTarget==='enter')l.reveal.enterBezier=[...safe];else l.reveal.exitBezier=[...safe];}
function syncCurveUI(){const curve=currentCurve();$('x1').value=curve[0];$('y1').value=curve[1];$('x2').value=curve[2];$('y2').value=curve[3];const opts=['<option value="custom">Custom</option>','<optgroup label="Built-in">',...Object.entries(BUILTIN_CURVES).map(([id,e])=>`<option value="builtin:${id}">${e.name}</option>`),'</optgroup>'];const custom=Object.entries(model.curvePresets||{});if(custom.length)opts.push('<optgroup label="My curves">',...custom.map(([id,e])=>`<option value="user:${id}">${escapeHtml(e.name||id)}</option>`),'</optgroup>');$('curvePreset').innerHTML=opts.join('');let value='custom';for(const[id,e]of Object.entries(BUILTIN_CURVES))if(curvesEqual(curve,e.curve))value=`builtin:${id}`;for(const[id,e]of custom)if(curvesEqual(curve,e.curve))value=`user:${id}`;$('curvePreset').value=value;$('deleteCurvePresetBtn').disabled=!value.startsWith('user:');updateCurveViz();}
function updateCurveViz(){const[x1,y1,x2,y2]=currentCurve(),left=20,right=240,top=20,bottom=150,sx=x=>left+x*(right-left),sy=y=>bottom-((y+.25)/1.5)*(bottom-top),start=[sx(0),sy(0)],p1=[sx(x1),sy(y1)],p2=[sx(x2),sy(y2)],end=[sx(1),sy(1)];$('curvePath').setAttribute('d',`M${start[0]} ${start[1]} C${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]} ${end[0]} ${end[1]}`);$('guide1').setAttribute('d',`M${start[0]} ${start[1]} L${p1[0]} ${p1[1]}`);$('guide2').setAttribute('d',`M${end[0]} ${end[1]} L${p2[0]} ${p2[1]}`);$('handle1').setAttribute('cx',p1[0]);$('handle1').setAttribute('cy',p1[1]);$('handle2').setAttribute('cx',p2[0]);$('handle2').setAttribute('cy',p2[1]);}
function syncCanvasInspector(){$('canvasWidth').value=model.canvasWidth;$('canvasHeight').value=model.canvasHeight;$('bgColor').value=model.bgColor;$('marginX').value=model.marginX;$('marginY').value=model.marginY;$('showGrid').checked=model.showGrid;$('showMargins').checked=model.showMargins;$('fps').value=model.fps;$('exportScale').value=model.exportScale;$('gifColors').value=model.gifColors;$('gifLoop').checked=model.gifLoop;$('loopBtn').classList.toggle('active',model.previewLoop);$('snapBtn').classList.toggle('active',model.snap);}
function syncAll({loadAssets=false}={}){syncLayerInspector();syncMotionInspector();syncCanvasInspector();syncTimeline();syncViewport();syncPlayhead();if(loadAssets){Object.values(model.layers).forEach(l=>{if(l.type==='text')ensureFont(l);if(l.type==='image')ensureImage(l);});}}

function syncViewport(){canvas.width=model.canvasWidth;canvas.height=model.canvasHeight;$('canvasReadout').textContent=`${model.canvasWidth} × ${model.canvasHeight}`;renderFrame(playhead);}
function syncPlayhead(){$('scrubber').value=String(playhead);syncTimeUI();renderFrame(playhead);updateTimelinePlayhead();}
function setPlayButton(){$('playBtn').classList.toggle('playing',isPlaying);$('playBtn').querySelector('span').textContent=isPlaying?'Pause':'Play';}
function pause(){isPlaying=false;if(rafId)cancelAnimationFrame(rafId);rafId=null;playbackOffsetMs=playhead*durationMs();setPlayButton();}
function play(){if(isPlaying){pause();return;}if(playhead>=1)playhead=0;playbackOffsetMs=playhead*durationMs();playbackStartedAt=performance.now();isPlaying=true;setPlayButton();rafId=requestAnimationFrame(tick);}
function tick(now){if(!isPlaying)return;const total=durationMs(),elapsed=(now-playbackStartedAt)*model.playbackRate+playbackOffsetMs;playhead=model.previewLoop?(elapsed%total)/total:clamp(elapsed/total,0,1);syncPlayhead();if(!model.previewLoop&&playhead>=1){pause();return;}rafId=requestAnimationFrame(tick);}
function restart(){pause();playhead=0;syncPlayhead();}
function stepFrame(dir){pause();const frames=Math.max(2,Math.round(durationMs()/1000*model.fps));playhead=clamp(playhead+dir/Math.max(1,frames-1),0,1);syncPlayhead();}

function addLayer(type){const index=model.counters[type]++;const id=`${type}-${Date.now().toString(36)}-${index}`;const layer=type==='text'?textLayer(id,index,model):type==='image'?imageLayer(id,index,model):nullLayer(id,index,model);model.layers[id]=layer;model.layerOrder.push(id);selectedLayerId=id;selectedCurveTarget='transform';if(type==='text')ensureFont(layer);if(type==='image')ensureImage(layer);syncAll();document.querySelector('.tab[data-tab="layer"]')?.click();commitHistory();}
function deleteSelectedLayer(){if(layerIds().length<=1)return;const id=selectedLayerId;Object.values(model.layers).forEach(l=>{if(l.parentId===id)reparentLayer(l.id,null);});delete model.layers[id];model.layerOrder=model.layerOrder.filter(x=>x!==id);imageCache.delete(id);selectedLayerId=layerIds()[0];syncAll();commitHistory();}
function selectLayer(id,openLayer=false){if(!model.layers[id])return;selectedLayerId=id;selectedCurveTarget='transform';syncAll();if(openLayer)document.querySelector('.tab[data-tab="layer"]')?.click();}

function bindSimple(id, read, write, {numeric=false,checkbox=false,after}={}){const el=$(id);const update=()=>{write(checkbox?el.checked:numeric?num(el.value,read()):el.value);if(after)after();else{syncTimeline();renderFrame(playhead);}scheduleSave();};el.addEventListener('input',update);el.addEventListener('change',()=>{update();commitHistory();});}
function setupLayerBindings(){
  $('layerName').addEventListener('input',()=>{selectedLayer().name=$('layerName').value.slice(0,50)||'Layer';syncTimeline();scheduleSave();});$('layerName').addEventListener('change',commitHistory);
  $('deleteLayerBtn').addEventListener('click',deleteSelectedLayer);
  $('parentLayer').addEventListener('change',()=>{const l=selectedLayer(),next=$('parentLayer').value||null;if(next&&wouldCreateCycle(l.id,next))return;reparentLayer(l.id,next);syncAll();commitHistory();});
  for(const[key,id]of[['x','baseX'],['y','baseY'],['scale','baseScale'],['rotation','baseRotation'],['opacity','baseOpacity']])bindSimple(id,()=>selectedLayer().base[key],v=>selectedLayer().base[key]=v,{numeric:true,after:()=>{const l=selectedLayer();if(!l.transform.enabled){l.transform.from=clone(l.base);l.transform.to=clone(l.base);}renderFrame(playhead);}});
  $('textValue').addEventListener('input',()=>{const l=selectedLayer();if(l.type!=='text')return;l.content.text=$('textValue').value;renderFrame(playhead);scheduleSave();});$('textValue').addEventListener('change',commitHistory);
  for(const[key,id]of[['fontSize','fontSize'],['fontWeight','fontWeight'],['letterSpacing','letterSpacing'],['maxWidth','textMaxWidth']])bindSimple(id,()=>selectedLayer().content?.[key],v=>{if(selectedLayer().type==='text')selectedLayer().content[key]=v;},{numeric:true,after:()=>renderFrame(playhead)});
  bindSimple('textColor',()=>selectedLayer().content?.color,v=>{if(selectedLayer().type==='text')selectedLayer().content.color=v;},{after:()=>renderFrame(playhead)});bindSimple('textAutoFit',()=>selectedLayer().content?.autoFit,v=>{if(selectedLayer().type==='text')selectedLayer().content.autoFit=v;},{checkbox:true,after:()=>renderFrame(playhead)});
  $('loadFontBtn').addEventListener('click',()=>{const l=selectedLayer();if(l.type!=='text')return;l.content.fontFamily=$('fontFamily').value.trim()||'Anton';ensureFont(l);commitHistory();});
  $('imageAsset').addEventListener('change',()=>{const l=selectedLayer();if(l.type!=='image')return;const kind=$('imageAsset').value;if(kind==='custom'){$('imageFile').click();return;}l.content.assetKind=kind;l.content.src=BUILTIN_ASSETS[kind];l.content.fileName='';imageCache.delete(l.id);ensureImage(l);syncLayerInspector();commitHistory();});
  bindSimple('imageWidth',()=>selectedLayer().content?.width,v=>{if(selectedLayer().type==='image')selectedLayer().content.width=v;},{numeric:true,after:()=>renderFrame(playhead)});bindSimple('imageTint',()=>selectedLayer().content?.tint,v=>{const l=selectedLayer();if(l.type==='image'){l.content.tint=v;imageCache.delete(l.id);ensureImage(l);}},{after:()=>renderFrame(playhead)});
  $('imageFile').addEventListener('change',()=>{const l=selectedLayer(),file=$('imageFile').files?.[0];if(!l||l.type!=='image'||!file)return;const reader=new FileReader();reader.onload=()=>{l.content.assetKind=file.size<=1500000?'custom':'custom-session';l.content.src=String(reader.result);l.content.fileName=file.name;imageCache.delete(l.id);ensureImage(l);syncLayerInspector();commitHistory();if(file.size>1500000)$('status').textContent='Large custom image is session-only and will not autosave.';};reader.readAsDataURL(file);});
}
function setupMotionBindings(){
  bindSimple('revealEnabled',()=>selectedLayer().reveal.enabled,v=>selectedLayer().reveal.enabled=v,{checkbox:true,after:()=>{syncMotionInspector();syncTimeline();syncPlayhead();}});
  for(const[prop,id]of[['start','revealStart'],['enter','enterDuration'],['hold','holdDuration'],['exit','exitDuration'],['travel','revealTravel'],['scaleFrom','revealScale'],['stagger','wordStagger']])bindSimple(id,()=>selectedLayer().reveal[prop],v=>selectedLayer().reveal[prop]=prop==='start'||['enter','hold','exit'].includes(prop)?Math.max(0,snapMs(v)):v,{numeric:true,after:()=>{if(prop==='stagger')$('wordStaggerOut').textContent=`${Math.round(selectedLayer().reveal.stagger)} ms`;syncMotionInspector();syncTimeline();syncPlayhead();}});
  bindSimple('enterDirection',()=>selectedLayer().reveal.enterDirection,v=>selectedLayer().reveal.enterDirection=v,{after:()=>renderFrame(playhead)});bindSimple('exitDirection',()=>selectedLayer().reveal.exitDirection,v=>selectedLayer().reveal.exitDirection=v,{after:()=>renderFrame(playhead)});
  bindSimple('wordStaggerOrder',()=>selectedLayer().reveal.staggerOrder||'forward',v=>selectedLayer().reveal.staggerOrder=v,{after:()=>{syncMotionInspector();syncTimeline();syncPlayhead();}});
  bindSimple('wordStaggerPhase',()=>selectedLayer().reveal.staggerPhase||'enter',v=>selectedLayer().reveal.staggerPhase=v,{after:()=>{syncMotionInspector();syncTimeline();syncPlayhead();}});
  document.querySelectorAll('[data-reveal-preset]').forEach(btn=>btn.addEventListener('click',()=>{const p=REVEAL_PRESETS[btn.dataset.revealPreset],l=selectedLayer();if(!p||!isVisual(l))return;l.reveal.enter=p.enter;l.reveal.hold=p.hold;l.reveal.exit=p.exit;l.reveal.travel=p.travel;l.reveal.scaleFrom=p.scaleFrom;l.reveal.enterBezier=[...BUILTIN_CURVES[p.enterCurve].curve];l.reveal.exitBezier=[...BUILTIN_CURVES[p.exitCurve].curve];syncAll();commitHistory();}));
  bindSimple('transformEnabled',()=>selectedLayer().transform.enabled,v=>selectedLayer().transform.enabled=v,{checkbox:true,after:()=>{syncLayerInspector();syncMotionInspector();syncTimeline();syncPlayhead();}});
  bindSimple('transformStart',()=>selectedLayer().transform.start,v=>selectedLayer().transform.start=Math.max(0,snapMs(v)),{numeric:true,after:()=>{syncMotionInspector();syncTimeline();syncPlayhead();}});bindSimple('transformDuration',()=>selectedLayer().transform.duration,v=>selectedLayer().transform.duration=Math.max(frameMs(),snapMs(v)),{numeric:true,after:()=>{syncMotionInspector();syncTimeline();syncPlayhead();}});
  for(const side of['A','B'])for(const[prop,suffix]of[['x','X'],['y','Y'],['scale',''],['rotation',''],['opacity','']]){const id=prop==='x'||prop==='y'?`pos${side}${suffix}`:prop==='scale'?`scale${side}`:prop==='rotation'?`rot${side}`:`opacity${side}`;bindSimple(id,()=>{const p=selectedLayer().transform;return(side==='A'?p.from:p.to)[prop];},v=>{const p=selectedLayer().transform;(side==='A'?p.from:p.to)[prop]=v;},{numeric:true,after:()=>{renderFrame(playhead);syncTimeline();}});}
  $('copyAToB').addEventListener('click',()=>{selectedLayer().transform.to=clone(selectedLayer().transform.from);syncMotionInspector();renderFrame(playhead);commitHistory();});$('copyBToA').addEventListener('click',()=>{selectedLayer().transform.from=clone(selectedLayer().transform.to);syncMotionInspector();renderFrame(playhead);commitHistory();});
  document.querySelectorAll('[data-transform-preset]').forEach(btn=>btn.addEventListener('click',()=>{const l=selectedLayer(),p=l.transform,b=clone(l.base),name=btn.dataset.transformPreset;p.enabled=true;p.start=0;p.duration=700;p.curve=[...BUILTIN_CURVES[name==='pop'?'back':'fast'].curve];p.to=clone(b);p.from=clone(b);if(name==='rise')p.from.y+=60;if(name==='slide-left')p.from.x-=100;if(name==='slide-right')p.from.x+=100;if(name==='pop'){p.from.scale*=.75;p.from.opacity=0;}if(name==='spin'){p.from.rotation-=90;p.from.opacity=0;}syncAll();commitHistory();}));
}
function setupCurveBindings(){
  $('curveTarget').addEventListener('change',()=>{selectedCurveTarget=$('curveTarget').value;syncCurveUI();});$('curvePreset').addEventListener('change',()=>{const v=$('curvePreset').value;let curve=null;if(v.startsWith('builtin:'))curve=BUILTIN_CURVES[v.slice(8)]?.curve;if(v.startsWith('user:'))curve=model.curvePresets[v.slice(5)]?.curve;if(!curve)return;setCurrentCurve(curve);syncCurveUI();renderFrame(playhead);commitHistory();});
  $('saveCurvePresetBtn').addEventListener('click',()=>{const name=$('curvePresetName').value.trim();if(!name)return;$('curvePresetName').value='';const id=`${name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'curve'}-${Date.now().toString(36).slice(-4)}`;model.curvePresets[id]={name:name.slice(0,32),curve:[...currentCurve()]};syncCurveUI();$('curvePreset').value=`user:${id}`;commitHistory();});$('deleteCurvePresetBtn').addEventListener('click',()=>{const v=$('curvePreset').value;if(!v.startsWith('user:'))return;delete model.curvePresets[v.slice(5)];syncCurveUI();commitHistory();});
  const update=()=>{setCurrentCurve([clamp(num($('x1').value),0,1),num($('y1').value,.9),clamp(num($('x2').value),0,1),num($('y2').value,1)]);syncCurveUI();renderFrame(playhead);scheduleSave();};['x1','y1','x2','y2'].forEach(id=>{$(id).addEventListener('input',update);$(id).addEventListener('change',()=>{update();commitHistory();});});
  const toPoint=e=>{const m=$('curveViz').getScreenCTM();if(!m)return null;const pt=$('curveViz').createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;return pt.matrixTransform(m.inverse());};const begin=(which,e)=>{activeDrag={kind:'curve',which};e.target.setPointerCapture?.(e.pointerId);e.preventDefault();};$('handle1').addEventListener('pointerdown',e=>begin(1,e));$('handle2').addEventListener('pointerdown',e=>begin(2,e));$('curveViz').addEventListener('pointermove',e=>{if(activeDrag?.kind!=='curve')return;const p=toPoint(e);if(!p)return;const curve=[...currentCurve()],x=clamp((p.x-20)/220,0,1),y=clamp(((150-p.y)/130)*1.5-.25,-2,3);curve[activeDrag.which===1?0:2]=Number(x.toFixed(2));curve[activeDrag.which===1?1:3]=Number(y.toFixed(2));setCurrentCurve(curve);syncCurveUI();renderFrame(playhead);scheduleSave();});const end=()=>{if(activeDrag?.kind==='curve'){activeDrag=null;commitHistory();}};$('curveViz').addEventListener('pointerup',end);$('curveViz').addEventListener('pointercancel',end);
}
function timelineTrackRect(){const track=document.querySelector('.timing-track');return track?.getBoundingClientRect()||null;}
function beginTimelineScrub(e,rect=timelineTrackRect()){
  if(!rect)return;
  pause();
  activeDrag={kind:'scrub',rect,total:durationMs(),pointerId:e.pointerId};
  document.body.classList.add('timeline-interacting');
  window.getSelection?.()?.removeAllRanges?.();
  try{e.currentTarget?.setPointerCapture?.(e.pointerId);}catch{}
  playhead=clamp((e.clientX-rect.left)/Math.max(1,rect.width),0,1);
  syncPlayhead();
  e.preventDefault();
}
function endTimelinePointerDrag(){
  if(!activeDrag||activeDrag.kind==='curve')return;
  const shouldCommit=activeDrag.kind!=='scrub';
  activeDrag=null;
  document.body.classList.remove('timeline-interacting');
  if(shouldCommit)commitHistory();
}
function setupTimeline(){
  $('layerTree').addEventListener('click',e=>{const row=e.target.closest('[data-layer-select]');if(row)selectLayer(row.dataset.layerSelect,true);});
  $('timeline').addEventListener('pointerdown',e=>{
    if(e.target.closest('.timeline-playhead')){beginTimelineScrub(e);return;}
    const track=e.target.closest('.timing-track');if(!track)return;
    const id=track.dataset.track,l=model.layers[id],rect=track.getBoundingClientRect(),total=durationMs(),tclip=e.target.closest('.transform-clip'),rbar=e.target.closest('.reveal-bar'),tedge=e.target.closest('[data-transform-edge]'),redge=e.target.closest('[data-reveal-edge]');
    if(!tclip&&!rbar){beginTimelineScrub(e,rect);return;}
    selectLayer(id,false);
    document.body.classList.add('timeline-interacting');
    window.getSelection?.()?.removeAllRanges?.();
    if(tclip){const p=l.transform;activeDrag={kind:tedge?`transform-${tedge.dataset.transformEdge}`:'transform-bar',id,rect,total,x0:e.clientX,start0:p.start,duration0:p.duration,end0:p.start+p.duration};}
    else{const r=l.reveal;activeDrag={kind:redge?`reveal-${redge.dataset.revealEdge}`:'reveal-bar',id,rect,total,x0:e.clientX,start0:r.start,enter0:r.enter,hold0:r.hold,exit0:r.exit};}
    e.preventDefault();
  });
  window.addEventListener('pointermove',e=>{
    if(!activeDrag||activeDrag.kind==='curve')return;
    const a=activeDrag;
    if(a.kind==='scrub'){
      e.preventDefault();
      window.getSelection?.()?.removeAllRanges?.();
      playhead=clamp((e.clientX-a.rect.left)/Math.max(1,a.rect.width),0,1);
      syncPlayhead();
      return;
    }
    const l=model.layers[a.id];if(!l)return;
    const dx=(e.clientX-a.x0)/Math.max(1,a.rect.width)*a.total;
    if(a.kind==='transform-a'){const end=a.end0,newStart=clamp(snapMs(a.start0+dx),0,Math.max(0,end-frameMs()));l.transform.start=newStart;l.transform.duration=end-newStart;}
    else if(a.kind==='transform-b'){l.transform.duration=Math.max(frameMs(),snapMs(a.duration0+dx));}
    else if(a.kind==='transform-bar'){l.transform.start=Math.max(0,snapMs(a.start0+dx));}
    else if(a.kind==='reveal-bar'||a.kind==='reveal-start'){l.reveal.start=Math.max(0,snapMs(a.start0+dx));}
    else if(a.kind==='reveal-enter'){const total=a.enter0+a.hold0+a.exit0,b=clamp(snapMs(a.enter0+dx),0,Math.max(0,total-a.exit0));l.reveal.enter=b;l.reveal.hold=Math.max(0,total-b-a.exit0);}
    else if(a.kind==='reveal-hold'){const total=a.enter0+a.hold0+a.exit0,b=clamp(snapMs(a.enter0+a.hold0+dx),a.enter0,total);l.reveal.hold=Math.max(0,b-a.enter0);l.reveal.exit=Math.max(0,total-a.enter0-l.reveal.hold);}
    else if(a.kind==='reveal-end'){l.reveal.exit=Math.max(0,snapMs(a.exit0+dx));}
    syncMotionInspector();syncTimeline();syncPlayhead();scheduleSave();
  },{passive:false});
  window.addEventListener('pointerup',endTimelinePointerDrag);
  window.addEventListener('pointercancel',endTimelinePointerDrag);
  $('timelineRuler').addEventListener('pointerdown',e=>beginTimelineScrub(e));
}
function setupCanvasBindings(){
  $('canvasPreset').addEventListener('change',()=>{const p=CANVAS_PRESETS[$('canvasPreset').value];if(!p)return;const sx=p[0]/model.canvasWidth,sy=p[1]/model.canvasHeight;Object.values(model.layers).forEach(l=>{l.base.x*=sx;l.base.y*=sy;l.transform.from.x*=sx;l.transform.from.y*=sy;l.transform.to.x*=sx;l.transform.to.y*=sy;if(l.type==='text')l.content.maxWidth*=sx;});model.canvasWidth=p[0];model.canvasHeight=p[1];syncAll();commitHistory();});
  for(const[id,key]of[['canvasWidth','canvasWidth'],['canvasHeight','canvasHeight'],['marginX','marginX'],['marginY','marginY'],['fps','fps']])bindSimple(id,()=>model[key],v=>model[key]=Math.max(1,Math.round(v)),{numeric:true,after:()=>{syncViewport();syncTimeline();syncCanvasInspector();}});bindSimple('bgColor',()=>model.bgColor,v=>model.bgColor=v,{after:()=>renderFrame(playhead)});bindSimple('showGrid',()=>model.showGrid,v=>model.showGrid=v,{checkbox:true,after:()=>renderFrame(playhead)});bindSimple('showMargins',()=>model.showMargins,v=>model.showMargins=v,{checkbox:true,after:()=>renderFrame(playhead)});bindSimple('exportScale',()=>model.exportScale,v=>model.exportScale=v,{numeric:true,after:syncTimeUI});bindSimple('gifColors',()=>model.gifColors,v=>model.gifColors=v,{numeric:true,after:syncTimeUI});bindSimple('gifLoop',()=>model.gifLoop,v=>model.gifLoop=v,{checkbox:true,after:syncTimeUI});
}
function setupTabs(){document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===tab));document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===tab.dataset.tab));}));}

async function exportGif(){const frames=Math.max(2,Math.min(360,Math.round(durationMs()/1000*model.fps))),delay=Math.round(1000/model.fps),scale=model.exportScale;$('exportBtn').disabled=true;$('exportProgress').value=0;$('status').textContent='Loading GIF encoder…';try{const{GIFEncoder,quantize,applyPalette}=await import('https://unpkg.com/gifenc@1.0.3?module');const out=document.createElement('canvas');out.width=Math.round(model.canvasWidth*scale);out.height=Math.round(model.canvasHeight*scale);const outCtx=out.getContext('2d',{willReadFrequently:true}),gif=GIFEncoder();for(let i=0;i<frames;i++){const t=i/(frames-1);renderFrame(t,outCtx,out.width,out.height,{hideGuides:true});const rgba=outCtx.getImageData(0,0,out.width,out.height).data,palette=quantize(rgba,model.gifColors,{format:'rgb565'}),indexed=applyPalette(rgba,palette,'rgb565');gif.writeFrame(indexed,out.width,out.height,{palette,delay,repeat:model.gifLoop?0:-1});$('exportProgress').value=(i+1)/frames;$('status').textContent=`Encoding ${i+1} / ${frames}…`;if(i%3===0)await new Promise(r=>setTimeout(r,0));}gif.finish();downloadBlob(new Blob([gif.bytes()],{type:'image/gif'}),`anim-${model.canvasWidth}x${model.canvasHeight}.gif`);$('status').textContent='GIF exported.';}catch(error){console.error(error);$('status').textContent=`Export failed: ${error.message||error}`;}finally{$('exportBtn').disabled=false;}}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);}
function exportPng(){const out=document.createElement('canvas');out.width=Math.round(model.canvasWidth*model.exportScale);out.height=Math.round(model.canvasHeight*model.exportScale);renderFrame(playhead,out.getContext('2d'),out.width,out.height,{hideGuides:true});out.toBlob(blob=>blob&&downloadBlob(blob,`anim-frame-${model.canvasWidth}x${model.canvasHeight}.png`),'image/png');}
function downloadSetup(){downloadBlob(new Blob([JSON.stringify({version:6,model:safeForStorage()},null,2)],{type:'application/json'}),'animation-studio-v6.json');}
async function importSetup(file){if(!file)return;try{const parsed=JSON.parse(await file.text()),incoming=parsed.model||parsed;model=normalizeModel(incoming);selectedLayerId=layerIds()[0];history=[JSON.stringify(model)];historyIndex=0;imageCache.clear();syncAll({loadAssets:true});saveNow();$('status').textContent='Setup loaded.';}catch(error){console.error(error);$('status').textContent='Could not load setup.';}finally{$('setupFile').value='';}}
function resetDefaults(){model=defaultModel();selectedLayerId='image-1';selectedCurveTarget='transform';playhead=0;history=[JSON.stringify(model)];historyIndex=0;imageCache.clear();syncAll({loadAssets:true});saveNow();}

function setupCommands(){
  $('addTextBtn').addEventListener('click',()=>addLayer('text'));$('addImageBtn').addEventListener('click',()=>addLayer('image'));$('addNullBtn').addEventListener('click',()=>addLayer('null'));
  $('playBtn').addEventListener('click',play);$('restartBtn').addEventListener('click',restart);$('prevFrameBtn').addEventListener('click',()=>stepFrame(-1));$('nextFrameBtn').addEventListener('click',()=>stepFrame(1));$('scrubber').addEventListener('input',()=>{pause();playhead=clamp(num($('scrubber').value),0,1);syncPlayhead();});
  $('loopBtn').addEventListener('click',()=>{model.previewLoop=!model.previewLoop;syncCanvasInspector();commitHistory();});$('snapBtn').addEventListener('click',()=>{model.snap=!model.snap;syncCanvasInspector();commitHistory();});$('undoBtn').addEventListener('click',undo);$('redoBtn').addEventListener('click',redo);$('resetBtn').addEventListener('click',resetDefaults);
  $('exportBtn').addEventListener('click',exportGif);$('pngBtn').addEventListener('click',exportPng);$('downloadSetupBtn').addEventListener('click',downloadSetup);$('loadSetupBtn').addEventListener('click',()=>$('setupFile').click());$('setupFile').addEventListener('change',()=>importSetup($('setupFile').files?.[0]));
  window.addEventListener('keydown',e=>{const edit=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}if(edit)return;if(e.code==='Space'){e.preventDefault();play();}if(e.key==='ArrowLeft'){e.preventDefault();stepFrame(-1);}if(e.key==='ArrowRight'){e.preventDefault();stepFrame(1);}if(e.key.toLowerCase()==='l')$('loopBtn').click();if(e.key.toLowerCase()==='s')$('snapBtn').click();});
  window.addEventListener('resize',updateTimelinePlayhead);window.addEventListener('beforeunload',saveNow);
}

async function initialize(){loadSaved();selectedLayerId=layerIds()[0]||'';history=[JSON.stringify(model)];historyIndex=0;setupTabs();setupLayerBindings();setupMotionBindings();setupCurveBindings();setupTimeline();setupCanvasBindings();setupCommands();syncAll({loadAssets:true});syncHistoryButtons();saveNow();}
initialize();
