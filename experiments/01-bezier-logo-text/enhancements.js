const STORAGE_KEY = 'anim-studio:enhancements:v1';
const FFMPEG_VERSION = '0.12.15';
const FFMPEG_CORE_VERSION = '0.12.10';
const CDN = 'https://cdn.jsdelivr.net/npm';

const $ = (id) => document.getElementById(id);
const sleepFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let parentMemory = loadParentMemory();
let parentMenu = null;
let parentObserver = null;
let ffmpegPromise = null;
let ffmpegWorkerUrl = null;
let exporting = false;

function loadParentMemory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch { return {}; }
}
function saveParentMemory() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(parentMemory)); } catch {}
}
function layerRows() {
  return [...document.querySelectorAll('#layerTree [data-layer-select]')];
}
function layerInfo() {
  return layerRows().map((row) => ({
    id: row.dataset.layerSelect,
    name: row.querySelector('.layer-copy strong')?.textContent?.trim() || row.textContent.trim() || 'Layer',
    parentName: row.querySelector('.layer-copy small')?.textContent?.replace(/^\s*↳\s*/, '').trim() || '',
    row,
  }));
}
function relationMapFromDom() {
  const infos = layerInfo();
  const nameToIds = new Map();
  infos.forEach(({ id, name }) => {
    const arr = nameToIds.get(name) || [];
    arr.push(id);
    nameToIds.set(name, arr);
  });
  const relations = {};
  infos.forEach(({ id, parentName }) => {
    if (parentMemory[id] && infos.some((info) => info.id === parentMemory[id])) {
      relations[id] = parentMemory[id];
      return;
    }
    const matches = parentName ? (nameToIds.get(parentName) || []) : [];
    relations[id] = matches.length === 1 ? matches[0] : null;
  });
  return relations;
}
function descendantsOf(rootId, relations) {
  const out = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [child, parent] of Object.entries(relations)) {
      if (!out.has(child) && (parent === rootId || out.has(parent))) {
        out.add(child);
        changed = true;
      }
    }
  }
  return out;
}
function parentLabel(id, relations, infos) {
  const parentId = relations[id];
  if (!parentId) return 'No parent';
  return infos.find((info) => info.id === parentId)?.name || 'Parent';
}

function patchInspectorParentOptions() {
  const select = $('parentLayer');
  const selectedRow = document.querySelector('#layerTree .layer-row.selected[data-layer-select]');
  if (!select || !selectedRow) return;
  const childId = selectedRow.dataset.layerSelect;
  const infos = layerInfo();
  const relations = relationMapFromDom();
  const descendants = descendantsOf(childId, relations);
  const current = relations[childId] || '';
  const options = [new Option('None', '')];
  infos.forEach(({ id, name }) => {
    if (id === childId || descendants.has(id)) return;
    options.push(new Option(name, id));
  });
  select.replaceChildren(...options);
  select.value = current;
}

function ensureInlineParentMenus() {
  const infos = layerInfo();
  const relations = relationMapFromDom();
  infos.forEach(({ id, row }) => {
    let chip = row.querySelector('.layer-parent-chip');
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'layer-parent-chip';
      chip.tabIndex = 0;
      chip.setAttribute('role', 'button');
      chip.setAttribute('aria-haspopup', 'menu');
      chip.addEventListener('pointerdown', (event) => event.stopPropagation());
      chip.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openParentMenu(id, chip);
      });
      chip.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          openParentMenu(id, chip);
        }
      });
      row.appendChild(chip);
    }
    const label = parentLabel(id, relations, infos);
    chip.classList.toggle('parented', Boolean(relations[id]));
    const markup = `<span class="parent-dot"></span><span class="parent-chip-label">${escapeHtml(label)}</span><span class="parent-chevron">⌄</span>`;
    if (chip.innerHTML !== markup) chip.innerHTML = markup;
    chip.title = relations[id] ? `Parented to ${label}` : 'Choose parent';
  });
  patchInspectorParentOptions();
}

function closeParentMenu() {
  parentMenu?.remove();
  parentMenu = null;
}
function openParentMenu(childId, anchor) {
  closeParentMenu();
  const infos = layerInfo();
  const relations = relationMapFromDom();
  const descendants = descendantsOf(childId, relations);
  const current = relations[childId] || '';
  const menu = document.createElement('div');
  menu.className = 'parent-popover';
  menu.setAttribute('role', 'menu');
  const makeItem = (id, name) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `parent-popover-item${current === id ? ' active' : ''}`;
    button.innerHTML = `<span>${escapeHtml(name)}</span>${current === id ? '<strong>✓</strong>' : ''}`;
    button.addEventListener('click', async () => {
      await applyParent(childId, id || null);
      closeParentMenu();
    });
    return button;
  };
  menu.appendChild(makeItem('', 'None'));
  const available = infos.filter(({ id }) => id !== childId && !descendants.has(id));
  if (available.length) {
    const divider = document.createElement('div');
    divider.className = 'parent-popover-divider';
    menu.appendChild(divider);
    available.forEach(({ id, name }) => menu.appendChild(makeItem(id, name)));
  }
  document.body.appendChild(menu);
  parentMenu = menu;
  const r = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const left = Math.min(window.innerWidth - m.width - 10, Math.max(10, r.right - m.width));
  const top = r.bottom + 6 + m.height > window.innerHeight ? Math.max(10, r.top - m.height - 6) : r.bottom + 6;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  const dismiss = (event) => {
    if (!menu.contains(event.target) && event.target !== anchor) {
      closeParentMenu();
      document.removeEventListener('pointerdown', dismiss, true);
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 0);
}
async function applyParent(childId, parentId) {
  const row = document.querySelector(`#layerTree [data-layer-select="${cssEscape(childId)}"]`);
  if (!row) return;
  row.click();
  await sleepFrame();
  patchInspectorParentOptions();
  const inspector = $('parentLayer');
  if (!inspector) return;
  if (parentId && ![...inspector.options].some((o) => o.value === parentId)) return;
  inspector.value = parentId || '';
  inspector.dispatchEvent(new Event('change', { bubbles: true }));
  parentMemory[childId] = parentId || null;
  saveParentMemory();
  await sleepFrame();
  ensureInlineParentMenus();
}
function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function installParentingUi() {
  const tree = $('layerTree');
  if (!tree) return;
  parentObserver?.disconnect();
  let queued = false;
  parentObserver = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      ensureInlineParentMenus();
    });
  });
  parentObserver.observe(tree, { childList: true, subtree: true, characterData: true });
  tree.addEventListener('click', () => requestAnimationFrame(patchInspectorParentOptions));
  $('parentLayer')?.addEventListener('change', () => {
    const selected = document.querySelector('#layerTree .layer-row.selected[data-layer-select]')?.dataset.layerSelect;
    if (!selected) return;
    parentMemory[selected] = $('parentLayer').value || null;
    saveParentMemory();
    requestAnimationFrame(ensureInlineParentMenus);
  });
  ensureInlineParentMenus();
}

function installExportUi() {
  const panel = document.querySelector('.tab-panel[data-panel="export"]');
  const exportButton = $('exportBtn');
  if (!panel || !exportButton || $('mediaExportFormat')) return;

  const heading = panel.querySelector('.section-heading');
  const controls = document.createElement('div');
  controls.className = 'media-export-controls';
  controls.innerHTML = `
    <div class="two-col">
      <label>Format
        <select id="mediaExportFormat">
          <option value="gif">GIF</option>
          <option value="webp">Animated WebP</option>
          <option value="webm">WebM · VP9</option>
          <option value="mp4">MP4 · H.264</option>
        </select>
      </label>
      <label>Quality
        <select id="mediaQuality">
          <option value="high">High</option>
          <option value="balanced" selected>Balanced</option>
          <option value="small">Smaller file</option>
        </select>
      </label>
    </div>
    <label class="check-row media-alpha-row"><input id="mediaAlpha" type="checkbox" checked /> Transparent background</label>
    <div id="mediaFormatNote" class="media-format-note"></div>
  `;
  heading.insertAdjacentElement('afterend', controls);

  const update = () => {
    const format = $('mediaExportFormat').value;
    const alpha = $('mediaAlpha');
    const alphaCapable = format === 'webp' || format === 'webm';
    alpha.disabled = !alphaCapable;
    if (!alphaCapable) alpha.checked = false;
    if (alphaCapable && alpha.dataset.wasAlpha !== 'off') alpha.checked = true;
    exportButton.textContent = format === 'gif' ? 'Export GIF' : format === 'webp' ? 'Export animated WebP' : format === 'webm' ? 'Export WebM' : 'Export MP4';
    const note = $('mediaFormatNote');
    if (format === 'webp') note.textContent = 'Animated WebP supports alpha. Encoder loads on demand.';
    else if (format === 'webm') note.textContent = 'VP9 WebM supports alpha. Encoder loads on demand.';
    else if (format === 'mp4') note.textContent = 'MP4 has no alpha here; the canvas background color is composited into every frame.';
    else note.textContent = 'GIF uses the existing lightweight encoder.';
  };
  $('mediaExportFormat').addEventListener('change', update);
  $('mediaAlpha').addEventListener('change', () => { $('mediaAlpha').dataset.wasAlpha = $('mediaAlpha').checked ? 'on' : 'off'; });
  update();

  exportButton.addEventListener('click', async (event) => {
    const format = $('mediaExportFormat')?.value || 'gif';
    if (format === 'gif') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (exporting) return;
    await exportWithFfmpeg(format);
  }, true);
}

function patchCanvasForCapture(context, transparent) {
  const originals = {
    fillRect: context.fillRect,
    stroke: context.stroke,
    strokeRect: context.strokeRect,
    fill: context.fill,
  };
  let skipBackground = false;
  context.fillRect = function(...args) {
    if (skipBackground) { skipBackground = false; return; }
    return originals.fillRect.apply(this, args);
  };
  context.stroke = function() {};
  context.strokeRect = function() {};
  context.fill = function() {};
  return {
    beforeFrame() { skipBackground = Boolean(transparent); },
    restore() {
      context.fillRect = originals.fillRect;
      context.stroke = originals.stroke;
      context.strokeRect = originals.strokeRect;
      context.fill = originals.fill;
    },
  };
}
function canvasBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(`Could not encode ${type}`)), type, quality));
}
async function capturePngFrames({ transparent }) {
  const stage = $('stage');
  const scrubber = $('scrubber');
  const progress = $('exportProgress');
  const status = $('status');
  const fps = Math.max(1, Number($('fps')?.value || 30));
  const scale = Math.max(.1, Number($('exportScale')?.value || 1));
  const totalSeconds = Math.max(.05, parseFloat($('totalTimeReadout')?.textContent || '1'));
  const frames = Math.max(2, Math.min(360, Math.round(totalSeconds * fps)));
  const original = { width: stage.width, height: stage.height, scrubber: scrubber.value };
  const outWidth = Math.max(2, Math.round(stage.width * scale));
  const outHeight = Math.max(2, Math.round(stage.height * scale));
  stage.width = outWidth;
  stage.height = outHeight;
  const context = stage.getContext('2d', { willReadFrequently: true });
  const patch = patchCanvasForCapture(context, transparent);
  const captured = [];
  try {
    for (let i = 0; i < frames; i++) {
      const t = i / (frames - 1);
      patch.beforeFrame();
      scrubber.value = String(t);
      scrubber.dispatchEvent(new Event('input', { bubbles: true }));
      await sleepFrame();
      captured.push(new Uint8Array(await (await canvasBlob(stage, 'image/png')).arrayBuffer()));
      progress.value = (i + 1) / frames * .48;
      status.textContent = `Rendering frames ${i + 1} / ${frames}…`;
      if (i % 4 === 0) await wait(0);
    }
  } finally {
    patch.restore();
    stage.width = original.width;
    stage.height = original.height;
    scrubber.value = original.scrubber;
    scrubber.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return { frames: captured, fps, width: outWidth, height: outHeight };
}

async function blobURL(url, mime) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Encoder download failed (${response.status})`);
  return URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: mime }));
}
async function classWorkerBlobURL() {
  if (ffmpegWorkerUrl) return ffmpegWorkerUrl;
  const base = `${CDN}/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm`;
  const response = await fetch(`${base}/worker.js`);
  if (!response.ok) throw new Error(`FFmpeg worker download failed (${response.status})`);
  let source = await response.text();
  source = source
    .replaceAll('"./const.js"', `"${base}/const.js"`)
    .replaceAll("'./const.js'", `'${base}/const.js'`)
    .replaceAll('"./errors.js"', `"${base}/errors.js"`)
    .replaceAll("'./errors.js'", `'${base}/errors.js'`);
  ffmpegWorkerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  return ffmpegWorkerUrl;
}
async function getFfmpeg() {
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    const status = $('status');
    status.textContent = 'Loading video encoder (~31 MB, first use only)…';
    const moduleUrl = `${CDN}/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm/index.js`;
    const { FFmpeg } = await import(moduleUrl);
    const ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
      const el = $('exportProgress');
      if (el && Number.isFinite(progress)) el.value = .5 + Math.max(0, Math.min(1, progress)) * .47;
    });
    const coreBase = `${CDN}/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
    await ffmpeg.load({
      classWorkerURL: await classWorkerBlobURL(),
      coreURL: await blobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await blobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    return ffmpeg;
  })().catch((error) => { ffmpegPromise = null; throw error; });
  return ffmpegPromise;
}

function qualityArgs(format) {
  const q = $('mediaQuality')?.value || 'balanced';
  if (format === 'webp') return q === 'high' ? ['-q:v','88'] : q === 'small' ? ['-q:v','62'] : ['-q:v','78'];
  if (format === 'webm') return q === 'high' ? ['-crf','15','-b:v','0'] : q === 'small' ? ['-crf','34','-b:v','0'] : ['-crf','24','-b:v','0'];
  return q === 'high' ? ['-crf','17'] : q === 'small' ? ['-crf','28'] : ['-crf','21'];
}
function ffmpegCommand(format, fps, alpha) {
  const input = ['-framerate', String(fps), '-i', 'frame%04d.png', '-an'];
  if (format === 'webp') return [...input, '-c:v', 'libwebp_anim', ...qualityArgs(format), '-loop', '0', ...(alpha ? ['-pix_fmt','yuva420p'] : ['-pix_fmt','yuv420p']), 'animation.webp'];
  if (format === 'webm') return [...input, '-c:v', 'libvpx-vp9', ...qualityArgs(format), '-row-mt', '1', '-auto-alt-ref', '0', ...(alpha ? ['-pix_fmt','yuva420p','-metadata:s:v:0','alpha_mode=1'] : ['-pix_fmt','yuv420p']), 'animation.webm'];
  return [...input, '-c:v', 'libx264', ...qualityArgs(format), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'animation.mp4'];
}
function outputMeta(format) {
  if (format === 'webp') return { file: 'animation.webp', mime: 'image/webp', ext: 'webp' };
  if (format === 'webm') return { file: 'animation.webm', mime: 'video/webm', ext: 'webm' };
  return { file: 'animation.mp4', mime: 'video/mp4', ext: 'mp4' };
}
async function exportWithFfmpeg(format) {
  const button = $('exportBtn');
  const progress = $('exportProgress');
  const status = $('status');
  const alpha = (format === 'webp' || format === 'webm') && Boolean($('mediaAlpha')?.checked);
  exporting = true;
  button.disabled = true;
  progress.value = 0;
  try {
    const captured = await capturePngFrames({ transparent: alpha });
    const ffmpeg = await getFfmpeg();
    status.textContent = `Preparing ${format.toUpperCase()} encoder…`;
    for (let i = 0; i < captured.frames.length; i++) {
      await ffmpeg.writeFile(`frame${String(i).padStart(4, '0')}.png`, captured.frames[i]);
      progress.value = .48 + (i + 1) / captured.frames.length * .04;
    }
    const meta = outputMeta(format);
    const code = await ffmpeg.exec(ffmpegCommand(format, captured.fps, alpha));
    if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`);
    const data = await ffmpeg.readFile(meta.file);
    progress.value = 1;
    downloadBlob(new Blob([data.buffer], { type: meta.mime }), `anim-${captured.width}x${captured.height}.${meta.ext}`);
    status.textContent = `${format.toUpperCase()} exported${alpha ? ' with alpha' : format === 'mp4' ? ' with canvas background' : ''}.`;
    await cleanupFfmpegFiles(ffmpeg, captured.frames.length, meta.file);
  } catch (error) {
    console.error(error);
    status.textContent = `Export failed: ${error.message || error}`;
  } finally {
    button.disabled = false;
    exporting = false;
  }
}
async function cleanupFfmpegFiles(ffmpeg, count, output) {
  const files = Array.from({ length: count }, (_, i) => `frame${String(i).padStart(4, '0')}.png`);
  files.push(output);
  await Promise.allSettled(files.map((file) => ffmpeg.deleteFile(file)));
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function boot() {
  installParentingUi();
  installExportUi();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0), { once: true });
else setTimeout(boot, 0);
