const DETAIL_STORAGE_KEY = 'anim-studio:timeline-details:v2';
const LEGACY_DETAIL_STORAGE_KEY = 'anim-studio:timeline-details:v1';
const PROJECT_STORAGE_KEY = 'anim-studio:experiment-01:v6';
const CURVE_Y_MIN = -1.25;
const CURVE_Y_MAX = 2.25;
const CURVE_SCALE_STEPS = [1, 1.5, 2, 3];
const MIN_CURVE_HEIGHT = 72;
const MAX_CURVE_HEIGHT = 280;

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const PROPERTY_SPECS = [
  { key: 'x', label: 'Position X', a: 'posAX', b: 'posBX', step: 0.5, min: -100000, max: 100000, format: (v) => `${formatNumber(v, 1)} px` },
  { key: 'y', label: 'Position Y', a: 'posAY', b: 'posBY', step: 0.5, min: -100000, max: 100000, format: (v) => `${formatNumber(v, 1)} px` },
  { key: 'scale', label: 'Scale', a: 'scaleA', b: 'scaleB', step: 0.005, min: 0.01, max: 20, format: (v) => `${formatNumber(v, 3)}×` },
  { key: 'rotation', label: 'Rotation', a: 'rotA', b: 'rotB', step: 0.5, min: -100000, max: 100000, format: (v) => `${formatNumber(v, 1)}°` },
  { key: 'opacity', label: 'Opacity', a: 'opacityA', b: 'opacityB', step: 0.005, min: 0, max: 1, format: (v) => `${Math.round(v * 100)}%` },
];

let prefs = loadPrefs();
let expanded = new Set(prefs.expanded || []);
let observer = null;
let renderQueued = false;
let curveDrag = null;
let curveResize = null;
let valueDrag = null;
let staggerDrag = null;
let scrollSyncing = false;
let editPopover = null;
const curveCache = new Map();

function loadPrefs() {
  for (const key of [DETAIL_STORAGE_KEY, LEGACY_DETAIL_STORAGE_KEY]) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '{}') || {};
      return {
        expanded: Array.isArray(raw.expanded) ? raw.expanded : [],
        curveVisible: raw.curveVisible && typeof raw.curveVisible === 'object' ? raw.curveVisible : {},
        curveScale: raw.curveScale && typeof raw.curveScale === 'object' ? raw.curveScale : {},
        curveHeight: raw.curveHeight && typeof raw.curveHeight === 'object' ? raw.curveHeight : {},
      };
    } catch {}
  }
  return { expanded: [], curveVisible: {}, curveScale: {}, curveHeight: {} };
}
function savePrefs() {
  prefs.expanded = [...expanded];
  try { localStorage.setItem(DETAIL_STORAGE_KEY, JSON.stringify(prefs)); } catch {}
}
function readProject() {
  try { return JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY) || '{}') || {}; } catch { return {}; }
}
function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function formatNumber(value, decimals = 2) {
  const n = num(value, 0);
  const fixed = n.toFixed(decimals);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
function originalLayerRows() {
  return [...document.querySelectorAll('#layerTree > .layer-row[data-layer-select]')];
}
function originalTimelineRows() {
  return [...document.querySelectorAll('#timeline > .timeline-row[data-layer]:not(.timeline-detail-row)')];
}
function selectedLayerId() {
  return document.querySelector('#layerTree > .layer-row.selected[data-layer-select]')?.dataset.layerSelect || null;
}
function parsePct(value, fallback = 0) {
  const n = Number.parseFloat(String(value || ''));
  return Number.isFinite(n) ? n : fallback;
}
function timelineTotalMs() {
  const seconds = Number.parseFloat($('totalTimeReadout')?.textContent || '');
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
}
function prefKey(layerId, target) { return `${layerId}:${target}`; }
function curveVisible(layerId, target) {
  const key = prefKey(layerId, target);
  return prefs.curveVisible[key] !== false;
}
function curveScale(layerId, target) {
  const value = num(prefs.curveScale[prefKey(layerId, target)], 1.5);
  return CURVE_SCALE_STEPS.reduce((best, item) => Math.abs(item - value) < Math.abs(best - value) ? item : best, 1.5);
}
function curveHeight(layerId, target) {
  return clamp(num(prefs.curveHeight[prefKey(layerId, target)], 116), MIN_CURVE_HEIGHT, MAX_CURVE_HEIGHT);
}
function setCurveVisible(layerId, target, visible) {
  prefs.curveVisible[prefKey(layerId, target)] = Boolean(visible);
  savePrefs();
}
function setCurveScale(layerId, target, value) {
  prefs.curveScale[prefKey(layerId, target)] = value;
  savePrefs();
}
function setCurveHeight(layerId, target, value) {
  prefs.curveHeight[prefKey(layerId, target)] = clamp(value, MIN_CURVE_HEIGHT, MAX_CURVE_HEIGHT);
  savePrefs();
}

function normalizeCurve(curve, fallback = [0.05, 0.9, 0.1, 1]) {
  if (!Array.isArray(curve) || curve.length !== 4) return [...fallback];
  return [
    clamp(num(curve[0], fallback[0]), 0, 1),
    num(curve[1], fallback[1]),
    clamp(num(curve[2], fallback[2]), 0, 1),
    num(curve[3], fallback[3]),
  ];
}
function curveKey(layerId, target) { return `${layerId}:${target}`; }
function projectCurve(layer, target) {
  if (!layer) return normalizeCurve(null);
  if (target === 'transform') return normalizeCurve(layer.transform?.curve);
  if (target === 'enter') return normalizeCurve(layer.reveal?.enterBezier);
  return normalizeCurve(layer.reveal?.exitBezier, [0.85, 0, 1, 0.2]);
}
function getCurve(layerId, target, projectLayer) {
  const cached = curveCache.get(curveKey(layerId, target));
  return cached ? [...cached] : projectCurve(projectLayer, target);
}
function setCurveCache(layerId, target, curve) {
  curveCache.set(curveKey(layerId, target), normalizeCurve(curve));
}
function readInspectorCurve() {
  const ids = ['x1', 'y1', 'x2', 'y2'];
  if (!ids.every((id) => $(id))) return null;
  const values = ids.map((id) => Number($(id).value));
  return values.every(Number.isFinite) ? normalizeCurve(values) : null;
}
function cacheCurrentInspectorCurve() {
  const layerId = selectedLayerId();
  const target = $('curveTarget')?.value;
  const curve = readInspectorCurve();
  if (layerId && target && curve) {
    setCurveCache(layerId, target, curve);
    refreshCurveSegments(layerId, target, curve);
  }
}

function overlaySelectedInspector(layerId, layer) {
  if (!layer || selectedLayerId() !== layerId) return layer;
  const out = JSON.parse(JSON.stringify(layer));
  out.transform = out.transform || {};
  out.transform.from = out.transform.from || {};
  out.transform.to = out.transform.to || {};
  out.reveal = out.reveal || {};
  if ($('transformEnabled')) out.transform.enabled = $('transformEnabled').checked;
  if ($('transformStart')) out.transform.start = num($('transformStart').value, out.transform.start);
  if ($('transformDuration')) out.transform.duration = num($('transformDuration').value, out.transform.duration);
  PROPERTY_SPECS.forEach((spec) => {
    if ($(spec.a)) out.transform.from[spec.key] = num($(spec.a).value, out.transform.from[spec.key]);
    if ($(spec.b)) out.transform.to[spec.key] = num($(spec.b).value, out.transform.to[spec.key]);
  });
  const revealMap = [
    ['revealStart', 'start'], ['enterDuration', 'enter'], ['holdDuration', 'hold'], ['exitDuration', 'exit'],
    ['wordStagger', 'stagger'],
  ];
  revealMap.forEach(([id, key]) => {
    if ($(id)) out.reveal[key] = num($(id).value, out.reveal[key]);
  });
  if ($('wordStaggerOrder')) out.reveal.staggerOrder = $('wordStaggerOrder').value;
  if ($('wordStaggerPhase')) out.reveal.staggerPhase = $('wordStaggerPhase').value;
  if (out.type === 'text' && $('textValue')) {
    out.content = out.content || {};
    out.content.text = $('textValue').value;
  }
  if ($('curveTarget')?.value === 'transform') out.transform.curve = readInspectorCurve() || out.transform.curve;
  if ($('curveTarget')?.value === 'enter') out.reveal.enterBezier = readInspectorCurve() || out.reveal.enterBezier;
  if ($('curveTarget')?.value === 'exit') out.reveal.exitBezier = readInspectorCurve() || out.reveal.exitBezier;
  return out;
}
function projectLayer(layerId) {
  const layer = readProject().layers?.[layerId] || null;
  return overlaySelectedInspector(layerId, layer);
}

function installDisclosure(row) {
  const id = row.dataset.layerSelect;
  if (!id) return;
  row.classList.add('has-disclosure');
  let disclosure = row.querySelector(':scope > .layer-disclosure');
  if (!disclosure) {
    disclosure = document.createElement('span');
    disclosure.className = 'layer-disclosure';
    disclosure.tabIndex = 0;
    disclosure.setAttribute('role', 'button');
    disclosure.setAttribute('aria-label', 'Show layer animation details');
    disclosure.addEventListener('pointerdown', (event) => event.stopPropagation());
    disclosure.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = !expanded.has(id);
      if (!row.classList.contains('selected')) row.click();
      if (next) expanded.add(id); else expanded.delete(id);
      savePrefs();
      renderDetails();
    });
    disclosure.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      disclosure.click();
    });
    row.prepend(disclosure);
  }
  const open = expanded.has(id);
  disclosure.textContent = open ? '⌄' : '›';
  disclosure.classList.toggle('open', open);
  disclosure.setAttribute('aria-expanded', String(open));
}

function selectLayer(layerId) {
  const row = document.querySelector(`#layerTree > .layer-row[data-layer-select="${cssEscape(layerId)}"]`);
  if (row && !row.classList.contains('selected')) row.click();
}
function selectLayerCurve(layerId, target) {
  selectLayer(layerId);
  const targetSelect = $('curveTarget');
  if (targetSelect) {
    targetSelect.value = target;
    targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
function setInspectorValue(layerId, inputId, value, commit = false) {
  selectLayer(layerId);
  const input = $(inputId);
  if (!input) return;
  input.value = String(value);
  input.dispatchEvent(new Event(commit ? 'change' : 'input', { bubbles: true }));
}

function makeLabelRow(layerId, depth, kind, text, meta = '', options = {}) {
  const row = document.createElement('div');
  row.className = `layer-detail-label layer-detail-${kind}${options.className ? ` ${options.className}` : ''}`;
  row.dataset.detailLayer = layerId;
  row.style.setProperty('--detail-depth', String(depth));
  if (options.height) row.style.height = `${options.height}px`;
  row.innerHTML = `<span class="detail-branch">${kind.startsWith('curve') ? '↳' : ''}</span><span class="detail-label-copy"><strong>${escapeHtml(text)}</strong>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</span>`;
  if (options.actions) row.appendChild(options.actions);
  row.addEventListener('click', (event) => {
    if (event.target.closest('button,input,select')) return;
    selectLayer(layerId);
  });
  return row;
}
function makeTimeRow(layerId, kind, height = null) {
  const row = document.createElement('div');
  row.className = `timeline-row timeline-detail-row timeline-detail-${kind}`;
  row.dataset.detailLayer = layerId;
  if (height) row.style.height = `${height}px`;
  return row;
}
function cloneRevealLane(layerId, sourceRow) {
  const bar = sourceRow.querySelector('.reveal-bar');
  if (!bar) return null;
  const row = makeTimeRow(layerId, 'reveal', 38);
  const track = document.createElement('div');
  track.className = 'timing-track detail-timing-track';
  track.dataset.track = layerId;
  const clone = bar.cloneNode(true);
  clone.classList.add('detail-mirror');
  track.appendChild(clone);
  row.appendChild(track);
  return row;
}
function cloneTransformLane(layerId, sourceRow) {
  const clip = sourceRow.querySelector('.transform-clip');
  if (!clip) return null;
  const row = makeTimeRow(layerId, 'transform', 36);
  const track = document.createElement('div');
  track.className = 'timing-track detail-timing-track';
  track.dataset.track = layerId;
  const clone = clip.cloneNode(true);
  clone.classList.add('detail-mirror');
  track.appendChild(clone);
  row.appendChild(track);
  return row;
}

function phaseGeometry(sourceRow, target) {
  if (target === 'transform') {
    const clip = sourceRow.querySelector('.transform-clip');
    if (!clip) return null;
    return { left: parsePct(clip.style.left), width: parsePct(clip.style.width) };
  }
  const reveal = sourceRow.querySelector('.reveal-bar');
  if (!reveal) return null;
  const left = parsePct(reveal.style.left);
  const width = parsePct(reveal.style.width);
  const enter = parsePct(reveal.querySelector('.phase.enter')?.style.width);
  const hold = parsePct(reveal.querySelector('.phase.hold')?.style.width);
  const exit = parsePct(reveal.querySelector('.phase.exit')?.style.width);
  if (target === 'enter') return { left, width: width * enter / 100 };
  return { left: left + width * (enter + hold) / 100, width: width * exit / 100 };
}

function makePropertyLane(layerId, sourceRow, layer, spec) {
  const geometry = phaseGeometry(sourceRow, 'transform');
  if (!geometry || !layer?.transform?.enabled) return null;
  const row = makeTimeRow(layerId, `property-${spec.key}`, 36);
  const track = document.createElement('div');
  track.className = 'timing-track detail-timing-track property-track';
  track.dataset.track = layerId;
  const from = num(layer.transform.from?.[spec.key], 0);
  const to = num(layer.transform.to?.[spec.key], 0);
  const clip = document.createElement('div');
  clip.className = 'transform-clip detail-property-clip';
  clip.dataset.transformClip = layerId;
  clip.style.left = `${geometry.left}%`;
  clip.style.width = `${Math.max(0.7, geometry.width)}%`;
  clip.innerHTML = `
    <button class="diamond a property-time-key" data-transform-edge="a" aria-label="${escapeHtml(spec.label)} A time"></button>
    <button class="property-value-chip value-a diamond timeline-control" type="button" data-layer-id="${layerId}" data-property="${spec.key}" data-side="A" title="Tap to edit · drag vertically to change">${escapeHtml(spec.format(from))}</button>
    <span class="transform-line property-value-line"></span>
    <button class="diamond b property-time-key" data-transform-edge="b" aria-label="${escapeHtml(spec.label)} B time"></button>
    <button class="property-value-chip value-b diamond timeline-control" type="button" data-layer-id="${layerId}" data-property="${spec.key}" data-side="B" title="Tap to edit · drag vertically to change">${escapeHtml(spec.format(to))}</button>
  `;
  clip.querySelectorAll('.property-value-chip').forEach((chip) => installPropertyValueChip(chip, layerId, spec));
  track.appendChild(clip);
  row.appendChild(track);
  return row;
}

function installPropertyValueChip(chip, layerId, spec) {
  chip.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectLayer(layerId);
    const side = chip.dataset.side;
    const inputId = side === 'A' ? spec.a : spec.b;
    const input = $(inputId);
    if (!input) return;
    valueDrag = {
      layerId, spec, side, inputId,
      startY: event.clientY,
      startValue: num(input.value, 0),
      pointerId: event.pointerId,
      moved: false,
    };
    document.body.classList.add('timeline-value-dragging');
    try { chip.setPointerCapture(event.pointerId); } catch {}
  });
  chip.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      selectLayer(layerId);
      const inputId = chip.dataset.side === 'A' ? spec.a : spec.b;
      openNumericEditor(chip, layerId, inputId, spec, `${spec.label} ${chip.dataset.side}`);
      return;
    }
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    selectLayer(layerId);
    const inputId = chip.dataset.side === 'A' ? spec.a : spec.b;
    const input = $(inputId);
    if (!input) return;
    const delta = (event.key === 'ArrowUp' ? 1 : -1) * spec.step * (event.shiftKey ? 10 : 1);
    const value = clamp(num(input.value, 0) + delta, spec.min, spec.max);
    setInspectorValue(layerId, inputId, value, true);
  });
}

function updateValueDrag(event) {
  if (!valueDrag || event.pointerId !== valueDrag.pointerId) return;
  event.preventDefault();
  const dy = event.clientY - valueDrag.startY;
  if (Math.abs(dy) > 3) valueDrag.moved = true;
  const raw = valueDrag.startValue - dy * valueDrag.spec.step;
  const value = clamp(raw, valueDrag.spec.min, valueDrag.spec.max);
  setInspectorValue(valueDrag.layerId, valueDrag.inputId, Number(value.toFixed(4)), false);
}
function endValueDrag(event) {
  if (!valueDrag || (event.pointerId != null && event.pointerId !== valueDrag.pointerId)) return;
  const done = valueDrag;
  valueDrag = null;
  document.body.classList.remove('timeline-value-dragging');
  const input = $(done.inputId);
  const value = input ? num(input.value, done.startValue) : done.startValue;
  if (done.moved) {
    setInspectorValue(done.layerId, done.inputId, value, true);
    queueRender();
  } else {
    requestAnimationFrame(() => {
      const row = document.querySelector(`.property-value-chip[data-layer-id="${cssEscape(done.layerId)}"][data-property="${cssEscape(done.spec.key)}"][data-side="${done.side}"]`);
      openNumericEditor(row, done.layerId, done.inputId, done.spec, `${done.spec.label} ${done.side}`);
    });
  }
}

function closeNumericEditor() {
  editPopover?.remove();
  editPopover = null;
}
function openNumericEditor(anchor, layerId, inputId, spec, label) {
  closeNumericEditor();
  selectLayer(layerId);
  const source = $(inputId);
  if (!source) return;
  const pop = document.createElement('form');
  pop.className = 'timeline-value-popover';
  pop.innerHTML = `
    <label><span>${escapeHtml(label)}</span><input type="number" inputmode="decimal" step="${spec.step}" min="${spec.min}" max="${spec.max}" value="${escapeHtml(source.value)}"></label>
    <div class="timeline-value-popover-actions"><button type="button" data-cancel>Cancel</button><button type="submit">Apply</button></div>`;
  document.body.appendChild(pop);
  editPopover = pop;
  const rect = anchor?.getBoundingClientRect?.() || { left: window.innerWidth / 2, top: window.innerHeight / 2, bottom: window.innerHeight / 2, width: 0 };
  requestAnimationFrame(() => {
    const p = pop.getBoundingClientRect();
    pop.style.left = `${clamp(rect.left + rect.width / 2 - p.width / 2, 8, window.innerWidth - p.width - 8)}px`;
    pop.style.top = `${rect.bottom + 8 + p.height < window.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - p.height - 8)}px`;
    const input = pop.querySelector('input');
    input?.focus();
    input?.select();
  });
  pop.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = pop.querySelector('input');
    const value = clamp(num(input.value, num(source.value, 0)), spec.min, spec.max);
    setInspectorValue(layerId, inputId, Number(value.toFixed(4)), true);
    closeNumericEditor();
    queueRender();
  });
  pop.querySelector('[data-cancel]').addEventListener('click', closeNumericEditor);
  pop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeNumericEditor(); }
  });
}

function wordCount(layer) {
  return String(layer?.content?.text || '').trim().split(/\s+/).filter(Boolean).length;
}
function staggerPhases(layer) {
  const phase = layer?.reveal?.staggerPhase || 'enter';
  if (phase === 'both') return ['enter', 'exit'];
  return phase === 'exit' ? ['exit'] : ['enter'];
}
function staggerPhaseStartMs(layer, phase) {
  const r = layer.reveal || {};
  if (phase === 'exit') return num(r.start) + num(r.enter) + num(r.hold);
  return num(r.start);
}
function makeStaggerLane(layerId, layer) {
  if (layer?.type !== 'text' || !layer.reveal) return null;
  const words = Math.max(1, wordCount(layer));
  const total = timelineTotalMs();
  const stagger = Math.max(0, num(layer.reveal.stagger, 0));
  const spread = words > 1 ? stagger * (words - 1) : 0;
  const row = makeTimeRow(layerId, 'word-stagger', 40);
  const track = document.createElement('div');
  track.className = 'timing-track detail-timing-track stagger-track';
  track.dataset.track = layerId;
  staggerPhases(layer).forEach((phase) => {
    const start = staggerPhaseStartMs(layer, phase);
    const left = clamp(start / total * 100, 0, 100);
    const width = clamp(Math.max(0.7, spread / total * 100), 0.7, Math.max(0.7, 100 - left));
    const span = document.createElement('div');
    span.className = `stagger-span stagger-${phase}`;
    span.dataset.layerId = layerId;
    span.dataset.staggerPhase = phase;
    span.style.left = `${left}%`;
    span.style.width = `${width}%`;
    span.innerHTML = `
      <button class="diamond stagger-keyframe first" type="button" data-stagger-edge="a" aria-label="${phase} first word start"></button>
      <span class="stagger-line"></span>
      <button class="diamond stagger-keyframe last" type="button" data-stagger-edge="b" aria-label="${phase} last word start"></button>
      <span class="stagger-offset first">0 ms</span>
      <span class="stagger-offset last">+${Math.round(spread)} ms</span>
      <button class="stagger-value-chip diamond timeline-control" type="button" title="Edit per-word stagger">${Math.round(stagger)} ms/word</button>
      <span class="stagger-phase-tag">${phase === 'enter' ? 'IN' : 'OUT'}</span>`;
    span.querySelectorAll('.stagger-keyframe').forEach((key) => {
      key.addEventListener('pointerdown', (event) => beginStaggerDrag(event, layerId, phase, key.dataset.staggerEdge, layer, words));
    });
    span.querySelector('.stagger-value-chip').addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });
    span.querySelector('.stagger-value-chip').addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const spec = { step: 1, min: 0, max: 5000 };
      openNumericEditor(event.currentTarget, layerId, 'wordStagger', spec, 'Word stagger (ms / word)');
    });
    track.appendChild(span);
  });
  row.appendChild(track);
  return row;
}
function beginStaggerDrag(event, layerId, phase, edge, layer, words) {
  event.preventDefault();
  event.stopPropagation();
  selectLayer(layerId);
  const track = event.currentTarget.closest('.timing-track');
  if (!track) return;
  const rect = track.getBoundingClientRect();
  staggerDrag = {
    layerId, phase, edge, words,
    pointerId: event.pointerId,
    startX: event.clientX,
    rect,
    total: timelineTotalMs(),
    revealStart: num($('revealStart')?.value, layer.reveal?.start),
    enter: num($('enterDuration')?.value, layer.reveal?.enter),
    hold: num($('holdDuration')?.value, layer.reveal?.hold),
    stagger: num($('wordStagger')?.value, layer.reveal?.stagger),
  };
  document.body.classList.add('timeline-stagger-dragging');
  try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
}
function updateStaggerDrag(event) {
  if (!staggerDrag || event.pointerId !== staggerDrag.pointerId) return;
  event.preventDefault();
  const d = staggerDrag;
  const dxMs = (event.clientX - d.startX) / Math.max(1, d.rect.width) * d.total;
  if (d.edge === 'b') {
    const spread0 = Math.max(0, d.stagger) * Math.max(0, d.words - 1);
    const spread = Math.max(0, spread0 + dxMs);
    const stagger = d.words > 1 ? spread / (d.words - 1) : 0;
    setInspectorValue(d.layerId, 'wordStagger', Number(stagger.toFixed(2)), false);
  } else if (d.phase === 'enter') {
    setInspectorValue(d.layerId, 'revealStart', Math.max(0, d.revealStart + dxMs), false);
  } else {
    setInspectorValue(d.layerId, 'holdDuration', Math.max(0, d.hold + dxMs), false);
  }
}
function endStaggerDrag(event) {
  if (!staggerDrag || (event.pointerId != null && event.pointerId !== staggerDrag.pointerId)) return;
  const done = staggerDrag;
  staggerDrag = null;
  document.body.classList.remove('timeline-stagger-dragging');
  const id = done.edge === 'b' ? 'wordStagger' : done.phase === 'enter' ? 'revealStart' : 'holdDuration';
  const input = $(id);
  if (input) setInspectorValue(done.layerId, id, num(input.value, 0), true);
  queueRender();
}

function curveYPercent(y) {
  return clamp((CURVE_Y_MAX - y) / (CURVE_Y_MAX - CURVE_Y_MIN) * 100, -18, 118);
}
function curvePath(curve) {
  const [x1, y1, x2, y2] = curve;
  return `M0 ${curveYPercent(0)} C${x1 * 100} ${curveYPercent(y1)} ${x2 * 100} ${curveYPercent(y2)} 100 ${curveYPercent(1)}`;
}
function curveDisplayGeometry(geometry, scale) {
  const desired = Math.max(20, geometry.width * scale, 22 * scale);
  const width = clamp(desired, 20, 94);
  const center = geometry.left + geometry.width / 2;
  const left = clamp(center - width / 2, 0, 100 - width);
  const spanLeft = clamp((geometry.left - left) / width * 100, 0, 100);
  const spanWidth = clamp(geometry.width / width * 100, 0.5, 100 - spanLeft);
  return { left, width, spanLeft, spanWidth };
}
function buildCurveSegment(layerId, target, geometry, curve, scale) {
  const display = curveDisplayGeometry(geometry, scale);
  const segment = document.createElement('div');
  segment.className = `inline-curve-segment curve-${target} diamond`;
  segment.dataset.layerId = layerId;
  segment.dataset.curveTarget = target;
  segment.style.left = `${display.left}%`;
  segment.style.width = `${display.width}%`;
  segment.title = `${target === 'transform' ? 'Transform' : target === 'enter' ? 'Entrance' : 'Exit'} easing · graph ${scale}× magnification`;
  segment.innerHTML = `
    <span class="curve-time-span" style="left:${display.spanLeft}%;width:${display.spanWidth}%"></span>
    <svg class="inline-curve-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line class="inline-curve-baseline" x1="0" y1="${curveYPercent(0)}" x2="100" y2="${curveYPercent(1)}"></line>
      <path class="inline-curve-path" d="${curvePath(curve)}"></path>
      <line class="inline-curve-guide guide-1" x1="0" y1="${curveYPercent(0)}" x2="${curve[0] * 100}" y2="${curveYPercent(curve[1])}"></line>
      <line class="inline-curve-guide guide-2" x1="100" y1="${curveYPercent(1)}" x2="${curve[2] * 100}" y2="${curveYPercent(curve[3])}"></line>
    </svg>
    <span class="curve-endpoint start"></span><span class="curve-endpoint end"></span>
    <span class="inline-curve-handle p1 diamond timeline-control" role="button" tabindex="0" data-handle="1" aria-label="Bezier control point 1"></span>
    <span class="inline-curve-handle p2 diamond timeline-control" role="button" tabindex="0" data-handle="2" aria-label="Bezier control point 2"></span>
    <span class="inline-curve-tag">${target === 'transform' ? 'A→B' : target === 'enter' ? 'IN' : 'OUT'} · ${scale}×</span>`;
  updateCurveSegment(segment, curve);
  segment.querySelectorAll('.inline-curve-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => beginCurveDrag(event, segment, Number(handle.dataset.handle)));
    handle.addEventListener('keydown', (event) => nudgeCurveHandle(event, segment, Number(handle.dataset.handle)));
  });
  segment.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.inline-curve-handle')) return;
    event.stopPropagation();
    selectLayerCurve(layerId, target);
  });
  return segment;
}
function updateCurveSegment(segment, curve) {
  const safe = normalizeCurve(curve);
  segment.dataset.curve = safe.join(',');
  const path = segment.querySelector('.inline-curve-path');
  if (path) path.setAttribute('d', curvePath(safe));
  const g1 = segment.querySelector('.guide-1');
  const g2 = segment.querySelector('.guide-2');
  if (g1) { g1.setAttribute('x2', String(safe[0] * 100)); g1.setAttribute('y2', String(curveYPercent(safe[1]))); }
  if (g2) { g2.setAttribute('x2', String(safe[2] * 100)); g2.setAttribute('y2', String(curveYPercent(safe[3]))); }
  const p1 = segment.querySelector('.p1');
  const p2 = segment.querySelector('.p2');
  if (p1) { p1.style.left = `${safe[0] * 100}%`; p1.style.top = `${curveYPercent(safe[1])}%`; }
  if (p2) { p2.style.left = `${safe[2] * 100}%`; p2.style.top = `${curveYPercent(safe[3])}%`; }
}
function makeCurveLane(layerId, target, sourceRow, projectLayer) {
  const geometry = phaseGeometry(sourceRow, target);
  if (!geometry || geometry.width <= 0) return null;
  const visible = curveVisible(layerId, target);
  const height = visible ? curveHeight(layerId, target) : 30;
  const row = makeTimeRow(layerId, `curve-${target}`, height);
  row.classList.add('curve-detail-row');
  row.dataset.curveLayer = layerId;
  row.dataset.curveTarget = target;
  const track = document.createElement('div');
  track.className = `curve-track${visible ? '' : ' curve-track-hidden'}`;
  track.dataset.curveLayer = layerId;
  track.dataset.curveTarget = target;
  if (visible) {
    track.appendChild(buildCurveSegment(layerId, target, geometry, getCurve(layerId, target, projectLayer), curveScale(layerId, target)));
    const resize = document.createElement('button');
    resize.type = 'button';
    resize.className = 'curve-resize-grip diamond timeline-control';
    resize.setAttribute('aria-label', 'Resize curve editor height');
    resize.title = 'Drag to resize curve editor';
    resize.addEventListener('pointerdown', (event) => beginCurveResize(event, layerId, target, row));
    track.appendChild(resize);
  } else {
    track.innerHTML = '<span class="curve-hidden-message">Curve graph hidden · use Show in the layer column</span>';
  }
  row.appendChild(track);
  return row;
}
function makeCurveActions(layerId, target) {
  const wrap = document.createElement('span');
  wrap.className = 'curve-row-actions';
  const show = document.createElement('button');
  show.type = 'button';
  show.className = `curve-row-control curve-visibility-toggle${curveVisible(layerId, target) ? ' active' : ''}`;
  show.textContent = curveVisible(layerId, target) ? 'Curve' : 'Show';
  show.title = curveVisible(layerId, target) ? 'Hide curve graph' : 'Show curve graph';
  show.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    setCurveVisible(layerId, target, !curveVisible(layerId, target));
    renderDetails();
  });
  wrap.appendChild(show);
  const minus = document.createElement('button');
  minus.type = 'button';
  minus.className = 'curve-row-control';
  minus.textContent = '−';
  minus.title = 'Reduce curve editor height';
  minus.disabled = !curveVisible(layerId, target);
  minus.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    setCurveHeight(layerId, target, curveHeight(layerId, target) - 24);
    renderDetails();
  });
  wrap.appendChild(minus);
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'curve-row-control';
  plus.textContent = '+';
  plus.title = 'Increase curve editor height';
  plus.disabled = !curveVisible(layerId, target);
  plus.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    setCurveHeight(layerId, target, curveHeight(layerId, target) + 24);
    renderDetails();
  });
  wrap.appendChild(plus);
  const zoom = document.createElement('button');
  zoom.type = 'button';
  zoom.className = 'curve-row-control curve-scale-control';
  zoom.textContent = `${curveScale(layerId, target)}×`;
  zoom.title = 'Magnify curve editor horizontally without changing animation timing';
  zoom.disabled = !curveVisible(layerId, target);
  zoom.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    const current = curveScale(layerId, target);
    const index = CURVE_SCALE_STEPS.indexOf(current);
    setCurveScale(layerId, target, CURVE_SCALE_STEPS[(index + 1) % CURVE_SCALE_STEPS.length]);
    renderDetails();
  });
  wrap.appendChild(zoom);
  return wrap;
}
function makeCurveLabel(layerId, depth, target, text) {
  const visible = curveVisible(layerId, target);
  const height = visible ? curveHeight(layerId, target) : 30;
  return makeLabelRow(layerId, depth, `curve-${target}`, text, visible ? 'P1 · P2 · drag graph handles' : 'Graph hidden', {
    actions: makeCurveActions(layerId, target),
    height,
    className: 'curve-label-row',
  });
}

function beginCurveResize(event, layerId, target, row) {
  event.preventDefault();
  event.stopPropagation();
  curveResize = {
    layerId, target, row,
    pointerId: event.pointerId,
    startY: event.clientY,
    startHeight: curveHeight(layerId, target),
  };
  document.body.classList.add('timeline-curve-resizing');
  try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
}
function updateCurveResize(event) {
  if (!curveResize || event.pointerId !== curveResize.pointerId) return;
  event.preventDefault();
  const next = clamp(curveResize.startHeight + (event.clientY - curveResize.startY), MIN_CURVE_HEIGHT, MAX_CURVE_HEIGHT);
  prefs.curveHeight[prefKey(curveResize.layerId, curveResize.target)] = next;
  curveResize.row.style.height = `${next}px`;
  const label = document.querySelector(`#layerTree > .curve-label-row[data-detail-layer="${cssEscape(curveResize.layerId)}"].layer-detail-curve-${cssEscape(curveResize.target)}`);
  if (label) label.style.height = `${next}px`;
}
function endCurveResize(event) {
  if (!curveResize || (event.pointerId != null && event.pointerId !== curveResize.pointerId)) return;
  setCurveHeight(curveResize.layerId, curveResize.target, num(prefs.curveHeight[prefKey(curveResize.layerId, curveResize.target)], curveResize.startHeight));
  curveResize = null;
  document.body.classList.remove('timeline-curve-resizing');
}

function applyCurve(layerId, target, curve, commit = false) {
  const safe = normalizeCurve(curve);
  selectLayerCurve(layerId, target);
  const fields = ['x1', 'y1', 'x2', 'y2'];
  if (!fields.every((id) => $(id))) return;
  fields.forEach((id, index) => { $(id).value = String(Number(safe[index].toFixed(3))); });
  $('x1').dispatchEvent(new Event('input', { bubbles: true }));
  setCurveCache(layerId, target, safe);
  refreshCurveSegments(layerId, target, safe);
  if (commit) $('x1').dispatchEvent(new Event('change', { bubbles: true }));
}
function beginCurveDrag(event, segment, which) {
  event.preventDefault();
  event.stopPropagation();
  const layerId = segment.dataset.layerId;
  const target = segment.dataset.curveTarget;
  const curve = normalizeCurve((segment.dataset.curve || '').split(',').map(Number));
  curveDrag = { layerId, target, which, curve, rect: segment.getBoundingClientRect(), pointerId: event.pointerId };
  selectLayerCurve(layerId, target);
  document.body.classList.add('timeline-curve-dragging');
  try { segment.setPointerCapture(event.pointerId); } catch {}
}
function updateCurveDrag(event) {
  if (!curveDrag || event.pointerId !== curveDrag.pointerId) return;
  event.preventDefault();
  const { rect, which } = curveDrag;
  const x = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  const ratioY = clamp((event.clientY - rect.top) / Math.max(1, rect.height), -0.35, 1.35);
  const y = clamp(CURVE_Y_MAX - ratioY * (CURVE_Y_MAX - CURVE_Y_MIN), -1.5, 2.5);
  if (which === 1) { curveDrag.curve[0] = x; curveDrag.curve[1] = y; }
  else { curveDrag.curve[2] = x; curveDrag.curve[3] = y; }
  applyCurve(curveDrag.layerId, curveDrag.target, curveDrag.curve, false);
}
function endCurveDrag(event) {
  if (!curveDrag || (event.pointerId != null && event.pointerId !== curveDrag.pointerId)) return;
  const done = curveDrag;
  curveDrag = null;
  document.body.classList.remove('timeline-curve-dragging');
  applyCurve(done.layerId, done.target, done.curve, true);
}
function nudgeCurveHandle(event, segment, which) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const curve = normalizeCurve((segment.dataset.curve || '').split(',').map(Number));
  const step = event.shiftKey ? 0.05 : 0.01;
  const xi = which === 1 ? 0 : 2;
  const yi = which === 1 ? 1 : 3;
  if (event.key === 'ArrowLeft') curve[xi] = clamp(curve[xi] - step, 0, 1);
  if (event.key === 'ArrowRight') curve[xi] = clamp(curve[xi] + step, 0, 1);
  if (event.key === 'ArrowUp') curve[yi] = clamp(curve[yi] + step, -1.5, 2.5);
  if (event.key === 'ArrowDown') curve[yi] = clamp(curve[yi] - step, -1.5, 2.5);
  applyCurve(segment.dataset.layerId, segment.dataset.curveTarget, curve, true);
}
function refreshCurveSegments(layerId, target, curve) {
  document.querySelectorAll(`.inline-curve-segment[data-layer-id="${cssEscape(layerId)}"][data-curve-target="${cssEscape(target)}"]`).forEach((segment) => updateCurveSegment(segment, curve));
}

function renderDetails() {
  const tree = $('layerTree');
  const timeline = $('timeline');
  if (!tree || !timeline) return;
  observer?.disconnect();
  try {
    tree.querySelectorAll(':scope > .layer-detail-label').forEach((node) => node.remove());
    timeline.querySelectorAll(':scope > .timeline-detail-row').forEach((node) => node.remove());

    const layerRows = originalLayerRows();
    const timeRows = originalTimelineRows();
    const validIds = new Set(layerRows.map((row) => row.dataset.layerSelect));
    expanded = new Set([...expanded].filter((id) => validIds.has(id)));

    layerRows.forEach((layerRow) => {
      installDisclosure(layerRow);
      const id = layerRow.dataset.layerSelect;
      if (!expanded.has(id)) return;
      const timeRow = timeRows.find((row) => row.dataset.layer === id);
      if (!timeRow) return;
      const depth = Number(layerRow.style.getPropertyValue('--depth') || 0);
      const layer = projectLayer(id);
      const detailLabels = document.createDocumentFragment();
      const detailTimes = document.createDocumentFragment();

      const revealLane = cloneRevealLane(id, timeRow);
      if (revealLane) {
        detailLabels.appendChild(makeLabelRow(id, depth, 'reveal', 'Reveal', 'Enter · Hold · Exit', { height: 38 }));
        detailTimes.appendChild(revealLane);
      }

      const transformLane = cloneTransformLane(id, timeRow);
      if (transformLane) {
        detailLabels.appendChild(makeLabelRow(id, depth, 'transform', 'Transform timing', 'Shared A → B time span', { height: 36 }));
        detailTimes.appendChild(transformLane);

        PROPERTY_SPECS.forEach((spec) => {
          const lane = makePropertyLane(id, timeRow, layer, spec);
          if (!lane) return;
          const from = num(layer?.transform?.from?.[spec.key], 0);
          const to = num(layer?.transform?.to?.[spec.key], 0);
          detailLabels.appendChild(makeLabelRow(id, depth, `property-${spec.key}`, spec.label, `${spec.format(from)} → ${spec.format(to)}`, { height: 36 }));
          detailTimes.appendChild(lane);
        });
      }

      const staggerLane = makeStaggerLane(id, layer);
      if (staggerLane) {
        const words = Math.max(1, wordCount(layer));
        const stagger = Math.max(0, num(layer?.reveal?.stagger, 0));
        const phase = layer?.reveal?.staggerPhase || 'enter';
        detailLabels.appendChild(makeLabelRow(id, depth, 'word-stagger', 'Word stagger', `${Math.round(stagger)} ms / word · ${words} word${words === 1 ? '' : 's'} · ${phase}`, { height: 40 }));
        detailTimes.appendChild(staggerLane);
      }

      if (transformLane) {
        const lane = makeCurveLane(id, 'transform', timeRow, layer);
        if (lane) {
          detailLabels.appendChild(makeCurveLabel(id, depth, 'transform', 'Transform curve'));
          detailTimes.appendChild(lane);
        }
      }
      if (revealLane) {
        const enterLane = makeCurveLane(id, 'enter', timeRow, layer);
        if (enterLane) {
          detailLabels.appendChild(makeCurveLabel(id, depth, 'enter', 'Entrance curve'));
          detailTimes.appendChild(enterLane);
        }
        const exitLane = makeCurveLane(id, 'exit', timeRow, layer);
        if (exitLane) {
          detailLabels.appendChild(makeCurveLabel(id, depth, 'exit', 'Exit curve'));
          detailTimes.appendChild(exitLane);
        }
      }

      layerRow.after(detailLabels);
      timeRow.after(detailTimes);
    });
    savePrefs();
  } finally {
    observeTimeline();
  }
}
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!curveDrag && !curveResize && !valueDrag && !staggerDrag && !editPopover) renderDetails();
  });
}
function observeTimeline() {
  const tree = $('layerTree');
  const timeline = $('timeline');
  if (!tree || !timeline) return;
  if (!observer) observer = new MutationObserver(queueRender);
  observer.disconnect();
  observer.observe(tree, { childList: true, subtree: true });
  observer.observe(timeline, { childList: true, subtree: true });
}
function installScrollSync() {
  const tree = $('layerTree');
  const timeline = $('timeline');
  if (!tree || !timeline || tree.dataset.detailScrollSync === '1') return;
  tree.dataset.detailScrollSync = '1';
  tree.addEventListener('scroll', () => {
    if (scrollSyncing) return;
    scrollSyncing = true;
    timeline.scrollTop = tree.scrollTop;
    requestAnimationFrame(() => { scrollSyncing = false; });
  }, { passive: true });
  timeline.addEventListener('scroll', () => {
    if (scrollSyncing) return;
    scrollSyncing = true;
    tree.scrollTop = timeline.scrollTop;
    requestAnimationFrame(() => { scrollSyncing = false; });
  }, { passive: true });
}
function installInspectorSync() {
  ['x1', 'y1', 'x2', 'y2'].forEach((id) => $(id)?.addEventListener('input', cacheCurrentInspectorCurve));
  $('curveTarget')?.addEventListener('change', () => setTimeout(cacheCurrentInspectorCurve, 0));
  $('curvePreset')?.addEventListener('change', () => setTimeout(cacheCurrentInspectorCurve, 0));

  const timelineInputs = [
    'transformStart','transformDuration','posAX','posAY','posBX','posBY','scaleA','scaleB','rotA','rotB','opacityA','opacityB',
    'revealStart','enterDuration','holdDuration','exitDuration','wordStagger','wordStaggerOrder','wordStaggerPhase','textValue',
  ];
  timelineInputs.forEach((id) => $(id)?.addEventListener('input', queueRender));
  timelineInputs.forEach((id) => $(id)?.addEventListener('change', queueRender));
}
function installPointerHandlers() {
  window.addEventListener('pointermove', (event) => {
    updateCurveDrag(event);
    updateCurveResize(event);
    updateValueDrag(event);
    updateStaggerDrag(event);
  }, { passive: false });
  window.addEventListener('pointerup', (event) => {
    endCurveDrag(event);
    endCurveResize(event);
    endValueDrag(event);
    endStaggerDrag(event);
  });
  window.addEventListener('pointercancel', (event) => {
    endCurveDrag(event);
    endCurveResize(event);
    endValueDrag(event);
    endStaggerDrag(event);
  });
}
function boot() {
  installScrollSync();
  installInspectorSync();
  installPointerHandlers();
  observeTimeline();
  renderDetails();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0), { once: true });
else setTimeout(boot, 0);
