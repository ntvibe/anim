const STORAGE_KEY = 'anim-studio:timeline-ui:v1';
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const TAP_SLOP = 9;

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

let zoom = loadZoom();
let baseTimeWidth = 0;
let selectionCleared = false;
let pinch = null;
let gesture = null;
const pointers = new Map();
let resizeTimer = null;
let treeObserver = null;

function loadZoom() {
  try {
    const value = Number(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').zoom);
    return Number.isFinite(value) ? clamp(value, MIN_ZOOM, MAX_ZOOM) : 1;
  } catch { return 1; }
}
function saveZoom() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ zoom })); } catch {}
}
function timelineParts() {
  return {
    grid: document.querySelector('.timeline-grid'),
    ruler: $('timelineRuler'),
    timeline: $('timeline'),
    tree: $('layerTree'),
    layerHead: document.querySelector('.layer-column-head'),
  };
}
function measureBaseWidth(force = false) {
  const { grid, ruler, layerHead } = timelineParts();
  if (!grid || !ruler) return 0;
  if (!force && baseTimeWidth > 0) return baseTimeWidth;
  const layerWidth = layerHead?.getBoundingClientRect().width || 0;
  const available = Math.max(240, grid.clientWidth - layerWidth);
  const current = ruler.getBoundingClientRect().width;
  baseTimeWidth = Math.max(available, zoom > 0 ? current / zoom : current, 400);
  return baseTimeWidth;
}
function ensureZoomBadge() {
  const head = document.querySelector('.timeline-title-row');
  if (!head) return null;
  let badge = $('timelineZoomBadge');
  if (!badge) {
    badge = document.createElement('button');
    badge.id = 'timelineZoomBadge';
    badge.type = 'button';
    badge.className = 'timeline-zoom-badge';
    badge.title = 'Timeline zoom · double tap or click to reset';
    badge.addEventListener('click', () => setZoom(1, null, true));
    head.appendChild(badge);
  }
  return badge;
}
function updateZoomBadge(active = false) {
  const badge = ensureZoomBadge();
  if (!badge) return;
  badge.textContent = `${Math.round(zoom * 100)}%`;
  badge.classList.toggle('active', active || zoom > 1.001);
}
function setZoom(nextZoom, anchorClientX = null, persist = false) {
  const { grid, ruler, timeline, layerHead } = timelineParts();
  if (!grid || !ruler || !timeline) return;
  const width = measureBaseWidth();
  const oldZoom = zoom;
  const oldWidth = width * oldZoom;
  zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  const newWidth = width * zoom;

  let contentRatio = null;
  let viewportX = null;
  if (anchorClientX != null) {
    const gridRect = grid.getBoundingClientRect();
    const timeStart = layerHead?.offsetWidth || 0;
    viewportX = anchorClientX - gridRect.left;
    const contentX = grid.scrollLeft + viewportX - timeStart;
    contentRatio = oldWidth > 0 ? contentX / oldWidth : 0;
  }

  ruler.style.width = `${newWidth}px`;
  ruler.style.minWidth = `${newWidth}px`;
  timeline.style.width = `${newWidth}px`;
  timeline.style.minWidth = `${newWidth}px`;
  document.documentElement.style.setProperty('--timeline-zoom', String(zoom));
  updateZoomBadge(pinch != null);

  if (contentRatio != null) {
    requestAnimationFrame(() => {
      const timeStart = layerHead?.offsetWidth || 0;
      grid.scrollLeft = Math.max(0, timeStart + contentRatio * newWidth - viewportX);
    });
  }
  if (persist) saveZoom();
}

function isTimelineControl(target) {
  return Boolean(target.closest('.reveal-bar,.transform-clip,.timeline-playhead,.edge-handle,.phase-handle,.diamond'));
}
function isTimeGestureZone(target) {
  return Boolean(target.closest('.timing-track,.timeline-ruler,.timeline-row,.timeline')) && !isTimelineControl(target);
}
function isEmptyTimelineTap(target) {
  return Boolean(target.closest('.timing-track,.timeline-row,.timeline')) && !target.closest('.reveal-bar,.transform-clip,.timeline-playhead,.edge-handle,.phase-handle,.diamond');
}
function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function activePair() {
  const values = [...pointers.values()];
  return values.length >= 2 ? [values[0], values[1]] : null;
}

function installCanvasSelectionFilter() {
  const stage = $('stage');
  if (!stage || stage.dataset.selectionFilter === '1') return;
  const context = stage.getContext('2d');
  if (!context) return;
  stage.dataset.selectionFilter = '1';
  const originalStroke = context.stroke.bind(context);
  const originalFill = context.fill.bind(context);
  const isSelectionBlue = () => /rgba?\(\s*47\s*,\s*120\s*,\s*255/i.test(String(context.strokeStyle));
  context.stroke = (...args) => selectionCleared && isSelectionBlue() ? undefined : originalStroke(...args);
  context.fill = (...args) => selectionCleared && isSelectionBlue() ? undefined : originalFill(...args);
}
function requestCanvasRedraw() {
  const bg = $('bgColor');
  if (bg) bg.dispatchEvent(new Event('input', { bubbles: true }));
}
function clearSelection() {
  selectionCleared = true;
  document.body.classList.add('timeline-selection-cleared');
  document.querySelectorAll('#layerTree .layer-row.selected').forEach((row) => row.classList.remove('selected'));
  document.activeElement?.blur?.();
  requestCanvasRedraw();
}
function restoreSelection() {
  if (!selectionCleared) return;
  selectionCleared = false;
  document.body.classList.remove('timeline-selection-cleared');
  requestCanvasRedraw();
}
function enforceDeselectedRows() {
  if (!selectionCleared) return;
  document.querySelectorAll('#layerTree .layer-row.selected').forEach((row) => row.classList.remove('selected'));
}

function beginPinch() {
  const pair = activePair();
  const { grid } = timelineParts();
  if (!pair || !grid) return;
  const mid = midpoint(pair[0], pair[1]);
  pinch = {
    startDistance: Math.max(1, pointDistance(pair[0], pair[1])),
    startZoom: zoom,
    midpointX: mid.x,
  };
  gesture = null;
  grid.classList.add('pinching');
  updateZoomBadge(true);
}
function updatePinch() {
  if (!pinch) return;
  const pair = activePair();
  if (!pair) return;
  const distance = Math.max(1, pointDistance(pair[0], pair[1]));
  const mid = midpoint(pair[0], pair[1]);
  setZoom(pinch.startZoom * distance / pinch.startDistance, mid.x, false);
}
function endPinchIfNeeded() {
  if (pointers.size >= 2) return;
  if (!pinch) return;
  pinch = null;
  timelineParts().grid?.classList.remove('pinching');
  updateZoomBadge(false);
  saveZoom();
}

function installTimelineGestures() {
  const { grid, timeline, ruler, tree } = timelineParts();
  if (!grid || !timeline || !ruler || grid.dataset.mobileGestures === '1') return;
  grid.dataset.mobileGestures = '1';
  measureBaseWidth(true);
  setZoom(zoom, null, false);

  grid.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    if (!isTimeGestureZone(event.target)) return;

    const p = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, target: event.target };
    pointers.set(event.pointerId, p);
    try { grid.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
    event.stopPropagation();

    if (pointers.size === 1) {
      gesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, startScroll: grid.scrollLeft, target: event.target, moved: false };
    } else if (pointers.size === 2) {
      beginPinch();
    }
  }, true);

  grid.addEventListener('pointermove', (event) => {
    const p = pointers.get(event.pointerId);
    if (!p) return;
    p.x = event.clientX; p.y = event.clientY;
    event.preventDefault();
    event.stopPropagation();

    if (pinch) {
      updatePinch();
      return;
    }
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (Math.hypot(dx, dy) > TAP_SLOP) gesture.moved = true;
    if (gesture.moved && Math.abs(dx) >= Math.abs(dy)) {
      grid.scrollLeft = Math.max(0, gesture.startScroll - dx);
    }
  }, true);

  const finish = (event) => {
    const p = pointers.get(event.pointerId);
    if (!p) return;
    const wasPinching = Boolean(pinch);
    pointers.delete(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    try { grid.releasePointerCapture(event.pointerId); } catch {}

    if (!wasPinching && gesture?.pointerId === event.pointerId && !gesture.moved && isEmptyTimelineTap(gesture.target)) {
      clearSelection();
    }
    gesture = null;
    endPinchIfNeeded();
  };
  grid.addEventListener('pointerup', finish, true);
  grid.addEventListener('pointercancel', finish, true);

  // A real layer/keyframe interaction restores the current layer selection.
  grid.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' && isTimelineControl(event.target)) restoreSelection();
  }, true);
  tree?.addEventListener('pointerdown', restoreSelection, true);

  treeObserver?.disconnect();
  treeObserver = new MutationObserver(enforceDeselectedRows);
  if (tree) treeObserver.observe(tree, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const oldZoom = zoom;
      baseTimeWidth = 0;
      measureBaseWidth(true);
      setZoom(oldZoom, null, false);
    }, 120);
  });
}

function boot() {
  installCanvasSelectionFilter();
  installTimelineGestures();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0), { once: true });
else setTimeout(boot, 0);
