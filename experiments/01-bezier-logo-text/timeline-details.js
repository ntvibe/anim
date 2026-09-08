const DETAIL_STORAGE_KEY = 'anim-studio:timeline-details:v1';
const PROJECT_STORAGE_KEY = 'anim-studio:experiment-01:v6';
const CURVE_Y_MIN = -1.25;
const CURVE_Y_MAX = 2.25;

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

let expanded = loadExpanded();
let observer = null;
let renderQueued = false;
let curveDrag = null;
let scrollSyncing = false;
const curveCache = new Map();

function loadExpanded() {
  try {
    const raw = JSON.parse(localStorage.getItem(DETAIL_STORAGE_KEY) || '{}');
    return new Set(Array.isArray(raw.expanded) ? raw.expanded : []);
  } catch { return new Set(); }
}
function saveExpanded() {
  try { localStorage.setItem(DETAIL_STORAGE_KEY, JSON.stringify({ expanded: [...expanded] })); } catch {}
}
function readProject() {
  try { return JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY) || '{}') || {}; } catch { return {}; }
}
function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
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
function curveKey(layerId, target) { return `${layerId}:${target}`; }
function normalizeCurve(curve, fallback = [0.05, 0.9, 0.1, 1]) {
  if (!Array.isArray(curve) || curve.length !== 4) return [...fallback];
  return [
    clamp(Number(curve[0]) || 0, 0, 1),
    Number.isFinite(Number(curve[1])) ? Number(curve[1]) : fallback[1],
    clamp(Number(curve[2]) || 0, 0, 1),
    Number.isFinite(Number(curve[3])) ? Number(curve[3]) : fallback[3],
  ];
}
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
      saveExpanded();
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

function makeLabelRow(layerId, depth, kind, text, meta = '') {
  const row = document.createElement('div');
  row.className = `layer-detail-label layer-detail-${kind}`;
  row.dataset.detailLayer = layerId;
  row.style.setProperty('--detail-depth', String(depth));
  row.innerHTML = `<span class="detail-branch">${kind.startsWith('curve') ? '↳' : ''}</span><span class="detail-label-copy"><strong>${text}</strong>${meta ? `<small>${meta}</small>` : ''}</span>`;
  row.addEventListener('click', () => selectLayer(layerId));
  return row;
}
function makeTimeRow(layerId, kind, heightClass = '') {
  const row = document.createElement('div');
  row.className = `timeline-row timeline-detail-row timeline-detail-${kind} ${heightClass}`.trim();
  row.dataset.detailLayer = layerId;
  return row;
}
function cloneRevealLane(layerId, sourceRow) {
  const bar = sourceRow.querySelector('.reveal-bar');
  if (!bar) return null;
  const row = makeTimeRow(layerId, 'reveal');
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
  const row = makeTimeRow(layerId, 'transform');
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
function curveYPercent(y) {
  return clamp((CURVE_Y_MAX - y) / (CURVE_Y_MAX - CURVE_Y_MIN) * 100, -18, 118);
}
function curvePath(curve) {
  const [x1, y1, x2, y2] = curve;
  return `M0 ${curveYPercent(0)} C${x1 * 100} ${curveYPercent(y1)} ${x2 * 100} ${curveYPercent(y2)} 100 ${curveYPercent(1)}`;
}
function buildCurveSegment(layerId, target, geometry, curve) {
  const segment = document.createElement('div');
  segment.className = `inline-curve-segment curve-${target} diamond`;
  segment.dataset.layerId = layerId;
  segment.dataset.curveTarget = target;
  segment.style.left = `${geometry.left}%`;
  segment.style.width = `${Math.max(0.7, geometry.width)}%`;
  segment.title = `${target === 'transform' ? 'Transform' : target === 'enter' ? 'Entrance' : 'Exit'} easing · drag P1 / P2`;
  segment.innerHTML = `
    <svg class="inline-curve-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line class="inline-curve-baseline" x1="0" y1="${curveYPercent(0)}" x2="100" y2="${curveYPercent(1)}"></line>
      <path class="inline-curve-path" d="${curvePath(curve)}"></path>
      <line class="inline-curve-guide guide-1" x1="0" y1="${curveYPercent(0)}" x2="${curve[0] * 100}" y2="${curveYPercent(curve[1])}"></line>
      <line class="inline-curve-guide guide-2" x1="100" y1="${curveYPercent(1)}" x2="${curve[2] * 100}" y2="${curveYPercent(curve[3])}"></line>
    </svg>
    <span class="curve-endpoint start"></span><span class="curve-endpoint end"></span>
    <span class="inline-curve-handle p1 diamond" role="button" tabindex="0" data-handle="1" aria-label="Bezier control point 1"></span>
    <span class="inline-curve-handle p2 diamond" role="button" tabindex="0" data-handle="2" aria-label="Bezier control point 2"></span>
    <span class="inline-curve-tag">${target === 'transform' ? 'A→B' : target === 'enter' ? 'IN' : 'OUT'}</span>`;
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
  const row = makeTimeRow(layerId, `curve-${target}`, 'curve-detail-row');
  const track = document.createElement('div');
  track.className = 'curve-track';
  track.dataset.curveLayer = layerId;
  track.dataset.curveTarget = target;
  track.appendChild(buildCurveSegment(layerId, target, geometry, getCurve(layerId, target, projectLayer)));
  row.appendChild(track);
  return row;
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

    const project = readProject();
    const layers = project.layers || {};
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
      const projectLayer = layers[id] || null;
      const detailLabels = document.createDocumentFragment();
      const detailTimes = document.createDocumentFragment();

      const revealLane = cloneRevealLane(id, timeRow);
      if (revealLane) {
        detailLabels.appendChild(makeLabelRow(id, depth, 'reveal', 'Reveal', 'Enter · Hold · Exit'));
        detailTimes.appendChild(revealLane);
      }
      const transformLane = cloneTransformLane(id, timeRow);
      if (transformLane) {
        detailLabels.appendChild(makeLabelRow(id, depth, 'transform', 'Transform', 'A → B keyframes'));
        detailTimes.appendChild(transformLane);
      }
      if (transformLane) {
        const lane = makeCurveLane(id, 'transform', timeRow, projectLayer);
        if (lane) {
          detailLabels.appendChild(makeLabelRow(id, depth, 'curve-transform', 'Transform curve', 'P1 · P2'));
          detailTimes.appendChild(lane);
        }
      }
      if (revealLane) {
        const enterLane = makeCurveLane(id, 'enter', timeRow, projectLayer);
        if (enterLane) {
          detailLabels.appendChild(makeLabelRow(id, depth, 'curve-enter', 'Entrance curve', 'P1 · P2'));
          detailTimes.appendChild(enterLane);
        }
        const exitLane = makeCurveLane(id, 'exit', timeRow, projectLayer);
        if (exitLane) {
          detailLabels.appendChild(makeLabelRow(id, depth, 'curve-exit', 'Exit curve', 'P1 · P2'));
          detailTimes.appendChild(exitLane);
        }
      }

      layerRow.after(detailLabels);
      timeRow.after(detailTimes);
    });
    saveExpanded();
  } finally {
    observeTimeline();
  }
}
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!curveDrag) renderDetails();
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
}
function installPointerHandlers() {
  window.addEventListener('pointermove', updateCurveDrag, { passive: false });
  window.addEventListener('pointerup', endCurveDrag);
  window.addEventListener('pointercancel', endCurveDrag);
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