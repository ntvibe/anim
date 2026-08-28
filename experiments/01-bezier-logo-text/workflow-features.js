const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'anim-studio:experiment-01:v3';
const CURVE_DEFAULTS = {
  enter: [0.05, 0.9, 0.1, 1],
  exit: [0.85, 0, 1, 0.2],
};

const MOTION_PRESETS = {
  smooth: {
    flowMode: 'in-hold-out', enterDuration: 700, holdDuration: 600, exitDuration: 650,
    enterDirection: 'from-bottom', exitDirection: 'to-top', logoTravel: 40, textTravel: 40,
    logoScale: 0.96, textScale: 0.98, wordStagger: 25,
    enterBezier: [0.22, 1, 0.36, 1], exitBezier: [0.65, 0, 0.35, 1],
  },
  snappy: {
    flowMode: 'in-hold-out', enterDuration: 450, holdDuration: 250, exitDuration: 400,
    enterDirection: 'from-bottom', exitDirection: 'to-top', logoTravel: 65, textTravel: 65,
    logoScale: 0.9, textScale: 0.94, wordStagger: 20,
    enterBezier: [0.16, 1, 0.3, 1], exitBezier: [0.65, 0, 0.35, 1],
  },
  soft: {
    flowMode: 'in-hold-out', enterDuration: 950, holdDuration: 800, exitDuration: 850,
    enterDirection: 'from-bottom', exitDirection: 'to-top', logoTravel: 28, textTravel: 28,
    logoScale: 0.98, textScale: 0.99, wordStagger: 40,
    enterBezier: [0.22, 1, 0.36, 1], exitBezier: [0.65, 0, 0.35, 1],
  },
  pop: {
    flowMode: 'in-hold-out', enterDuration: 600, holdDuration: 450, exitDuration: 550,
    enterDirection: 'from-bottom', exitDirection: 'to-top', logoTravel: 30, textTravel: 34,
    logoScale: 0.84, textScale: 0.9, wordStagger: 28,
    enterBezier: [0.34, 1.56, 0.64, 1], exitBezier: [0.22, 1, 0.36, 1],
  },
};

const ui = {
  loopBtn: $('loopBtn'), previewLoop: $('previewLoop'), snapBtn: $('snapBtn'), saveStatus: $('saveStatus'),
  fps: $('fps'), timeline: $('timeline'), curveTarget: $('curveTarget'), preset: $('preset'),
  x1: $('x1'), y1: $('y1'), x2: $('x2'), y2: $('y2'), loadFontBtn: $('loadFontBtn'),
  downloadSetupBtn: $('downloadSetupBtn'), loadSetupBtn: $('loadSetupBtn'), setupFile: $('setupFile'),
  resetBtn: $('resetBtn'),
};

let snapEnabled = true;
let isRestoring = false;
let saveTimer = null;
let curveCache = {
  enter: [...CURVE_DEFAULTS.enter],
  exit: [...CURVE_DEFAULTS.exit],
};

const waitFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const dispatch = (el, name) => el?.dispatchEvent(new Event(name, { bubbles: true }));
const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function editableControls() {
  return [...document.querySelectorAll('input[id], select[id]')].filter((el) => {
    if (['file', 'button', 'submit'].includes(el.type)) return false;
    if (['scrubber', 'logoType', 'exportProgress'].includes(el.id)) return false;
    return true;
  });
}

function updateCurveCache() {
  const target = ui.curveTarget?.value || 'enter';
  const values = [ui.x1, ui.y1, ui.x2, ui.y2].map((el) => numeric(el?.value));
  if (values.every(Number.isFinite)) curveCache[target] = values;
}

function serializeSetup() {
  updateCurveCache();
  const values = {};
  editableControls().forEach((el) => {
    values[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  const activeLogo = document.querySelector('[data-logo-type].active')?.dataset.logoType || 'wordmark';
  return {
    version: 3,
    savedAt: new Date().toISOString(),
    values,
    curves: {
      enter: [...curveCache.enter],
      exit: [...curveCache.exit],
    },
    logoType: activeLogo === 'custom' ? 'wordmark' : activeLogo,
    snapEnabled,
  };
}

function setSaveStatus(text, state = 'saved') {
  if (!ui.saveStatus) return;
  ui.saveStatus.classList.toggle('saving', state === 'saving');
  ui.saveStatus.classList.toggle('error', state === 'error');
  const dot = '<i></i>';
  ui.saveStatus.innerHTML = `${dot}${text}`;
}

function saveNow() {
  if (isRestoring) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeSetup()));
    setSaveStatus('Autosaved');
  } catch {
    setSaveStatus('Save unavailable', 'error');
  }
}

function scheduleSave() {
  if (isRestoring) return;
  setSaveStatus('Saving…', 'saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
}

function setField(id, value, { commit = true } = {}) {
  const el = $(id);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = Boolean(value);
  else el.value = String(value);
  dispatch(el, 'input');
  if (commit) dispatch(el, 'change');
}

function applyCurve(target, values) {
  if (!Array.isArray(values) || values.length !== 4) return;
  setField('curveTarget', target);
  [ui.x1, ui.y1, ui.x2, ui.y2].forEach((el, index) => {
    if (!el) return;
    el.value = String(values[index]);
    dispatch(el, 'input');
  });
  dispatch(ui.y2, 'change');
  curveCache[target] = values.map(Number);
}

function setLoop(enabled, { commit = true } = {}) {
  if (!ui.previewLoop || !ui.loopBtn) return;
  ui.previewLoop.checked = Boolean(enabled);
  dispatch(ui.previewLoop, 'input');
  if (commit) dispatch(ui.previewLoop, 'change');
  ui.loopBtn.classList.toggle('active', Boolean(enabled));
  ui.loopBtn.setAttribute('aria-pressed', String(Boolean(enabled)));
  ui.loopBtn.title = `${enabled ? 'Disable' : 'Enable'} playback loop (L)`;
}

function setSnap(enabled) {
  snapEnabled = Boolean(enabled);
  ui.snapBtn?.classList.toggle('active', snapEnabled);
  ui.snapBtn?.setAttribute('aria-pressed', String(snapEnabled));
}

function applySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.values) return false;
  isRestoring = true;
  try {
    const skip = new Set(['curveTarget', 'preset', 'x1', 'y1', 'x2', 'y2', 'previewLoop']);
    for (const [id, value] of Object.entries(snapshot.values)) {
      if (skip.has(id) || !$(id)) continue;
      setField(id, value);
    }

    const logoType = snapshot.logoType || 'wordmark';
    document.querySelector(`[data-logo-type="${logoType}"]`)?.click();

    curveCache = {
      enter: Array.isArray(snapshot.curves?.enter) ? snapshot.curves.enter.map(Number) : [...CURVE_DEFAULTS.enter],
      exit: Array.isArray(snapshot.curves?.exit) ? snapshot.curves.exit.map(Number) : [...CURVE_DEFAULTS.exit],
    };
    const selectedCurve = snapshot.values.curveTarget === 'exit' ? 'exit' : 'enter';
    applyCurve('enter', curveCache.enter);
    applyCurve('exit', curveCache.exit);
    setField('curveTarget', selectedCurve);

    setLoop(snapshot.values.previewLoop !== false, { commit: true });
    setSnap(snapshot.snapEnabled !== false);
    if (snapshot.values.fontFamily) ui.loadFontBtn?.click();
    return true;
  } finally {
    isRestoring = false;
    setTimeout(saveNow, 60);
  }
}

function loadSavedSetup() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return applySnapshot(JSON.parse(raw));
  } catch {
    return false;
  }
}

function applyMotionPreset(name) {
  const preset = MOTION_PRESETS[name];
  if (!preset) return;
  isRestoring = true;
  try {
    const scalarKeys = ['flowMode', 'enterDuration', 'holdDuration', 'exitDuration', 'enterDirection', 'exitDirection', 'logoTravel', 'textTravel', 'logoScale', 'textScale', 'wordStagger'];
    scalarKeys.forEach((key) => setField(key, preset[key]));
    applyCurve('enter', preset.enterBezier);
    applyCurve('exit', preset.exitBezier);
    setField('curveTarget', 'enter');
    document.querySelectorAll('[data-motion-preset]').forEach((button) => button.classList.toggle('active', button.dataset.motionPreset === name));
  } finally {
    isRestoring = false;
    scheduleSave();
  }
}

function frameMs() {
  const fps = Math.max(1, numeric(ui.fps?.value, 30));
  return 1000 / fps;
}

function snapValue(value) {
  const step = frameMs();
  return Math.max(0, Math.round(numeric(value) / step) * step);
}

function snapTimelineValues() {
  if (!snapEnabled) return;
  isRestoring = true;
  try {
    ['logoStart', 'logoEnd', 'textStart', 'textEnd', 'enterDuration', 'holdDuration', 'exitDuration'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      const snapped = Math.round(snapValue(el.value));
      if (Math.abs(numeric(el.value) - snapped) < 0.5) return;
      el.value = String(snapped);
      dispatch(el, 'input');
      dispatch(el, 'change');
    });
  } finally {
    isRestoring = false;
    scheduleSave();
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function downloadSetup() {
  const payload = serializeSetup();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `animation-studio-setup-${new Date().toISOString().slice(0, 10)}.json`);
}

async function importSetup(file) {
  if (!file) return;
  try {
    const snapshot = JSON.parse(await file.text());
    if (!applySnapshot(snapshot)) throw new Error('Invalid setup');
    setSaveStatus('Imported');
  } catch {
    setSaveStatus('Import failed', 'error');
  } finally {
    if (ui.setupFile) ui.setupFile.value = '';
  }
}

function setupInteractions() {
  ui.loopBtn?.addEventListener('click', () => {
    setLoop(!ui.previewLoop.checked);
    scheduleSave();
  });
  ui.snapBtn?.addEventListener('click', () => {
    setSnap(!snapEnabled);
    scheduleSave();
  });

  document.querySelectorAll('[data-motion-preset]').forEach((button) => {
    button.addEventListener('click', () => applyMotionPreset(button.dataset.motionPreset));
  });

  document.addEventListener('input', (event) => {
    if (isRestoring) return;
    if (event.target?.id && event.target.matches('input,select')) scheduleSave();
  });
  document.addEventListener('change', (event) => {
    if (['curveTarget', 'preset', 'x1', 'y1', 'x2', 'y2'].includes(event.target?.id)) updateCurveCache();
  });

  ui.timeline?.addEventListener('pointerup', () => requestAnimationFrame(snapTimelineValues));

  ui.downloadSetupBtn?.addEventListener('click', downloadSetup);
  ui.loadSetupBtn?.addEventListener('click', () => ui.setupFile?.click());
  ui.setupFile?.addEventListener('change', () => importSetup(ui.setupFile.files?.[0]));

  ui.resetBtn?.addEventListener('click', () => {
    setTimeout(() => {
      setLoop(true);
      setSnap(true);
      document.querySelectorAll('[data-motion-preset]').forEach((button) => button.classList.remove('active'));
      saveNow();
    }, 50);
  });

  window.addEventListener('keydown', (event) => {
    const editable = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (editable || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() === 'l') {
      event.preventDefault();
      ui.loopBtn?.click();
    }
    if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      ui.snapBtn?.click();
    }
  });

  window.addEventListener('beforeunload', saveNow);
}

await waitFrame();
await waitFrame();
setupInteractions();
updateCurveCache();
const restored = loadSavedSetup();
if (!restored) {
  setLoop(true);
  setSnap(true);
  saveNow();
}
