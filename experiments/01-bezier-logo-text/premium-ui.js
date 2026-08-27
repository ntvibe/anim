const $ = (id) => document.getElementById(id);

const ui = {
  topExportBtn: $('topExportBtn'),
  exportBtn: $('exportBtn'),
  inspectorTitle: $('inspectorTitle'),
  timelineRuler: $('timelineRuler'),
  totalTimeReadout: $('totalTimeReadout'),
  frameEstimate: $('frameEstimate'),
  scrubber: $('scrubber'),
  timeline: $('timeline'),
  flowMode: $('flowMode'),
  enterDuration: $('enterDuration'),
  holdDuration: $('holdDuration'),
  exitDuration: $('exitDuration'),
  fps: $('fps'),
  curveViz: $('curveViz'),
  handle1: $('handle1'),
  handle2: $('handle2'),
  x1: $('x1'), y1: $('y1'), x2: $('x2'), y2: $('y2'),
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const numberValue = (el, fallback = 0) => Number.isFinite(Number(el?.value)) ? Number(el.value) : fallback;

function lifecycleDurationMs() {
  const enter = clamp(numberValue(ui.enterDuration, 850), 50, 5000);
  const hold = clamp(numberValue(ui.holdDuration, 1400), 0, 10000);
  const exit = clamp(numberValue(ui.exitDuration, 750), 50, 5000);
  if (ui.flowMode?.value === 'out') return exit;
  if (ui.flowMode?.value === 'in-stay') return enter + hold;
  return enter + hold + exit;
}

function formatTime(ms, precise = false) {
  const seconds = ms / 1000;
  if (precise) return `${seconds.toFixed(2)} s`;
  if (seconds >= 10) return `${seconds.toFixed(1)}s`;
  const rounded = Math.round(seconds * 100) / 100;
  return `${String(rounded).replace(/\.0+$/, '')}s`;
}

function syncTimeUI() {
  const duration = lifecycleDurationMs();
  if (ui.totalTimeReadout) ui.totalTimeReadout.value = formatTime(duration, true);
  if (ui.timelineRuler) {
    const points = [0, .25, .5, .75, 1];
    ui.timelineRuler.innerHTML = points.map((p) => `<span>${formatTime(duration * p)}</span>`).join('');
  }
  if (ui.frameEstimate) {
    const fps = clamp(Math.round(numberValue(ui.fps, 30)), 8, 60);
    ui.frameEstimate.textContent = String(Math.max(2, Math.min(240, Math.round(duration / 1000 * fps))));
  }
}

function activateTab(name) {
  const tab = document.querySelector(`.tab[data-tab="${name}"]`);
  if (tab) tab.click();
}

function setupInspectorTitles() {
  const titles = { typography: 'Type', lockup: 'Lockup', logo: 'Logo', motion: 'Motion', canvas: 'Canvas', export: 'Export' };
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (ui.inspectorTitle) ui.inspectorTitle.textContent = titles[tab.dataset.tab] || 'Inspector';
    });
  });
}

function setupLayerSelection() {
  const layerTabs = { lockup: 'lockup', logo: 'logo', text: 'typography', background: 'canvas' };
  document.querySelectorAll('[data-select-layer]').forEach((row) => {
    row.addEventListener('click', () => {
      document.querySelectorAll('[data-select-layer]').forEach((item) => item.classList.toggle('selected', item === row));
      const target = layerTabs[row.dataset.selectLayer];
      if (target) activateTab(target);
    });
  });
}

function setupTimelineScrub() {
  ui.timeline?.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.timing-bar')) return;
    const track = event.target.closest('.timing-track') || ui.timeline.querySelector('.timing-track');
    if (!track || !ui.scrubber) return;
    const rect = track.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right) return;
    ui.scrubber.value = String(clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1));
    ui.scrubber.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function svgPointFromEvent(event) {
  const svg = ui.curveViz;
  if (!svg) return null;
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(matrix.inverse());
}

function setupCurveDrag() {
  if (!ui.curveViz || !ui.handle1 || !ui.handle2) return;
  let active = null;

  const begin = (handle, event) => {
    active = handle === ui.handle1 ? 1 : 2;
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  ui.handle1.addEventListener('pointerdown', (event) => begin(ui.handle1, event));
  ui.handle2.addEventListener('pointerdown', (event) => begin(ui.handle2, event));

  ui.curveViz.addEventListener('pointermove', (event) => {
    if (!active) return;
    const p = svgPointFromEvent(event);
    if (!p) return;
    const left = 20, right = 240, top = 20, bottom = 150;
    const x = clamp((p.x - left) / (right - left), 0, 1);
    const y = clamp(((bottom - p.y) / (bottom - top)) * 1.5 - .25, -2, 3);
    const xInput = active === 1 ? ui.x1 : ui.x2;
    const yInput = active === 1 ? ui.y1 : ui.y2;
    xInput.value = x.toFixed(2);
    yInput.value = y.toFixed(2);
    xInput.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const stop = () => { active = null; };
  ui.curveViz.addEventListener('pointerup', stop);
  ui.curveViz.addEventListener('pointercancel', stop);
}

function setupTopExport() {
  ui.topExportBtn?.addEventListener('click', () => ui.exportBtn?.click());
}

function setupDurationObservers() {
  [ui.flowMode, ui.enterDuration, ui.holdDuration, ui.exitDuration, ui.fps].forEach((el) => {
    el?.addEventListener('input', syncTimeUI);
    el?.addEventListener('change', syncTimeUI);
  });
}

setupTopExport();
setupInspectorTitles();
setupLayerSelection();
setupTimelineScrub();
setupCurveDrag();
setupDurationObservers();
syncTimeUI();
