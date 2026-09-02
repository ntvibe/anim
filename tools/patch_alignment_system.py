from pathlib import Path
import re

root = Path('experiments/01-bezier-logo-text')
app_path = root / 'app.js'
html_path = root / 'index.html'
css_path = root / 'style.css'
app = app_path.read_text()
html = html_path.read_text()
css = css_path.read_text()


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Pattern not found: {label}')
    return text.replace(old, new, 1)

# --- model + alignment geometry -------------------------------------------------
if 'const ALIGN_POINTS =' not in app:
    marker = 'const clone = (v) => JSON.parse(JSON.stringify(v));'
    alignment_constants = '''const ALIGN_POINTS = {
  tl: [0, 0], tc: [.5, 0], tr: [1, 0],
  cl: [0, .5], cc: [.5, .5], cr: [1, .5],
  bl: [0, 1], bc: [.5, 1], br: [1, 1],
};
const ALIGN_NAMES = {
  tl: 'Top left', tc: 'Top center', tr: 'Top right',
  cl: 'Center left', cc: 'Center', cr: 'Center right',
  bl: 'Bottom left', bc: 'Bottom center', br: 'Bottom right',
};

'''
    app = replace_once(app, marker, alignment_constants + marker, 'alignment constants')

if 'function alignmentDefaults()' not in app:
    marker = 'function textLayer(id, index, model) {'
    helper = '''function alignmentDefaults() {
  return { reference: 'bounds', anchor: 'cc', target: 'canvas' };
}
'''
    app = replace_once(app, marker, helper + marker, 'alignment defaults')

app = app.replace("id, type: 'text', name: `Text ${index}`, parentId: null, base,\n    content:", "id, type: 'text', name: `Text ${index}`, parentId: null, base, alignment: alignmentDefaults(),\n    content:")
app = app.replace("id, type: 'image', name: index === 1 ? 'Logo' : `Image ${index}`, parentId: null, base,\n    content:", "id, type: 'image', name: index === 1 ? 'Logo' : `Image ${index}`, parentId: null, base, alignment: alignmentDefaults(),\n    content:")
app = app.replace("return { id, type: 'null', name: `Null ${index}`, parentId: null, base, reveal:", "return { id, type: 'null', name: `Null ${index}`, parentId: null, base, alignment: alignmentDefaults(), reveal:")

norm_marker = "  out.reveal = { ...revealDefaults(layer.type), ...(layer.reveal||{}) };"
if "out.alignment =" not in app:
    app = replace_once(app, norm_marker, "  out.alignment = { ...alignmentDefaults(), ...(layer.alignment||{}) };\n" + norm_marker, 'normalize alignment')

if 'function alignmentState(layer)' not in app:
    marker = 'async function ensureFont(layer) {'
    funcs = r'''function alignmentState(layer) {
  if (!layer.alignment) layer.alignment = alignmentDefaults();
  if (!ALIGN_POINTS[layer.alignment.anchor]) layer.alignment.anchor = 'cc';
  if (!['bounds','anchor'].includes(layer.alignment.reference)) layer.alignment.reference = 'bounds';
  if (!['canvas','safe'].includes(layer.alignment.target)) layer.alignment.target = 'canvas';
  return layer.alignment;
}
function matrixPoint(matrix, x, y) {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] };
}
function localVisualBounds(layer) {
  if (layer.type === 'text') {
    const c = layer.content;
    ctx.save();
    const size = fittedFontSize(ctx, layer);
    ctx.font = `${c.fontWeight} ${size}px "${c.fontFamily}", sans-serif`;
    const width = Math.max(1, textWidth(ctx, c.text || ' ', c.letterSpacing));
    const metrics = ctx.measureText(c.text || 'M');
    const metricHeight = (metrics.actualBoundingBoxAscent || size * .76) + (metrics.actualBoundingBoxDescent || size * .24);
    const height = Math.max(1, metricHeight, size);
    ctx.restore();
    return { left: -width / 2, top: -height / 2, right: width / 2, bottom: height / 2 };
  }
  if (layer.type === 'image') {
    const image = imageCache.get(layer.id)?.image;
    const width = Math.max(1, num(layer.content.width, 1));
    const ratio = image?.naturalWidth ? image.naturalHeight / image.naturalWidth : 1;
    const height = Math.max(1, width * ratio);
    return { left: -width / 2, top: -height / 2, right: width / 2, bottom: height / 2 };
  }
  return { left: 0, top: 0, right: 0, bottom: 0 };
}
function pointInBounds(bounds, key) {
  const [u, v] = ALIGN_POINTS[key] || ALIGN_POINTS.cc;
  return { x: lerp(bounds.left, bounds.right, u), y: lerp(bounds.top, bounds.bottom, v) };
}
function worldBounds(layer, ms) {
  const matrix = worldMatrix(layer.id, ms);
  const b = localVisualBounds(layer);
  const corners = [
    matrixPoint(matrix, b.left, b.top), matrixPoint(matrix, b.right, b.top),
    matrixPoint(matrix, b.right, b.bottom), matrixPoint(matrix, b.left, b.bottom),
  ];
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}
function worldAlignmentAnchor(layer, ms) {
  const anchor = alignmentState(layer).anchor;
  const local = pointInBounds(localVisualBounds(layer), anchor);
  return matrixPoint(worldMatrix(layer.id, ms), local.x, local.y);
}
function alignmentSourcePoint(layer, pointKey, ms) {
  const a = alignmentState(layer);
  return a.reference === 'anchor' ? worldAlignmentAnchor(layer, ms) : pointInBounds(worldBounds(layer, ms), pointKey);
}
function alignmentTargetPoint(pointKey, target) {
  const safe = target === 'safe';
  const bounds = safe
    ? { left: model.marginX, top: model.marginY, right: model.canvasWidth - model.marginX, bottom: model.canvasHeight - model.marginY }
    : { left: 0, top: 0, right: model.canvasWidth, bottom: model.canvasHeight };
  return pointInBounds(bounds, pointKey);
}
function shiftLayerWorld(layer, dx, dy, ms) {
  const influence = parentInfluenceAt(layer, ms).matrix;
  const inv = matInv(influence);
  const localDx = inv[0] * dx + inv[2] * dy;
  const localDy = inv[1] * dx + inv[3] * dy;
  [layer.base, layer.transform.from, layer.transform.to].forEach((value) => {
    value.x += localDx;
    value.y += localDy;
  });
}
async function alignSelectedLayer(pointKey) {
  const layer = selectedLayer();
  if (!layer || !ALIGN_POINTS[pointKey]) return;
  if (layer.type === 'image') await ensureImage(layer);
  const ms = playhead * durationMs();
  const a = alignmentState(layer);
  const source = alignmentSourcePoint(layer, pointKey, ms);
  const target = alignmentTargetPoint(pointKey, a.target);
  shiftLayerWorld(layer, target.x - source.x, target.y - source.y, ms);
  syncAll();
  commitHistory();
  scheduleSave();
}
'''
    app = replace_once(app, marker, funcs + marker, 'alignment geometry functions')

# Draw a non-exported alignment-anchor marker for the selected visual layer.
if 'function drawSelectedAlignmentAnchor' not in app:
    marker = 'function renderFrame(t, targetCtx = ctx, width = canvas.width, height = canvas.height, options = {}) {'
    func = r'''function drawSelectedAlignmentAnchor(context, ms) {
  const layer = selectedLayer();
  if (!layer || layer.type === 'null') return;
  const p = worldAlignmentAnchor(layer, ms);
  context.save();
  context.translate(p.x, p.y);
  context.strokeStyle = 'rgba(47,120,255,.95)';
  context.fillStyle = 'rgba(255,255,255,.96)';
  context.lineWidth = 1.5;
  context.beginPath(); context.arc(0, 0, 5, 0, Math.PI * 2); context.fill(); context.stroke();
  context.beginPath(); context.moveTo(-9, 0); context.lineTo(-5, 0); context.moveTo(5, 0); context.lineTo(9, 0); context.moveTo(0, -9); context.lineTo(0, -5); context.moveTo(0, 5); context.lineTo(0, 9); context.stroke();
  context.restore();
}
'''
    app = replace_once(app, marker, func + marker, 'alignment anchor canvas marker')

app = app.replace('drawGuides(targetCtx); drawSelectedNull(targetCtx,ms);', 'drawGuides(targetCtx); drawSelectedNull(targetCtx,ms); drawSelectedAlignmentAnchor(targetCtx,ms);')

# Inspector sync.
base_sync = "  ['baseX','baseY','baseScale','baseRotation','baseOpacity'].forEach(id=>$(id).disabled=l.transform.enabled);"
if "$('alignReference').value" not in app:
    align_sync = '''  const align = alignmentState(l);
  $('alignReference').value = align.reference;
  $('alignTarget').value = align.target;
  document.querySelectorAll('[data-align-anchor]').forEach((button) => button.classList.toggle('active', button.dataset.alignAnchor === align.anchor));
  $('alignAnchorName').textContent = ALIGN_NAMES[align.anchor] || 'Center';
  $('alignHelp').textContent = align.reference === 'anchor'
    ? `The ${ALIGN_NAMES[align.anchor] || 'selected'} object anchor is placed on the frame point you click.`
    : 'Each placement button aligns the matching side, corner, or center of the current object bounds.';
'''
    app = replace_once(app, base_sync, align_sync + base_sync, 'alignment inspector sync')

# Bind alignment controls before the base-transform bindings.
base_bind = "  for(const[key,id]of[['x','baseX'],['y','baseY'],['scale','baseScale'],['rotation','baseRotation'],['opacity','baseOpacity']])"
if "$('alignReference').addEventListener" not in app:
    bindings = '''  $('alignReference').addEventListener('change',()=>{const l=selectedLayer();alignmentState(l).reference=$('alignReference').value;syncLayerInspector();renderFrame(playhead);commitHistory();scheduleSave();});
  $('alignTarget').addEventListener('change',()=>{const l=selectedLayer();alignmentState(l).target=$('alignTarget').value;syncLayerInspector();commitHistory();scheduleSave();});
  document.querySelectorAll('[data-align-anchor]').forEach((button)=>button.addEventListener('click',()=>{const l=selectedLayer(),a=alignmentState(l);a.anchor=button.dataset.alignAnchor;a.reference='anchor';syncLayerInspector();renderFrame(playhead);commitHistory();scheduleSave();}));
  document.querySelectorAll('[data-align-place]').forEach((button)=>button.addEventListener('click',()=>alignSelectedLayer(button.dataset.alignPlace)));
'''
    app = replace_once(app, base_bind, bindings + base_bind, 'alignment bindings')

# --- inspector UI ---------------------------------------------------------------
if 'id="alignmentControls"' not in html:
    marker = '\n\n        <div id="textControls"'
    points = [('tl','Top left'),('tc','Top center'),('tr','Top right'),('cl','Center left'),('cc','Center'),('cr','Center right'),('bl','Bottom left'),('bc','Bottom center'),('br','Bottom right')]
    anchor_buttons = ''.join(f'<button type="button" class="align-point" data-point="{key}" data-align-anchor="{key}" title="Anchor: {name}" aria-label="Anchor {name}"><span></span></button>' for key,name in points)
    place_buttons = ''.join(f'<button type="button" class="align-point place" data-point="{key}" data-align-place="{key}" title="Align {name}" aria-label="Align {name}"><span></span></button>' for key,name in points)
    block = f'''\n\n        <div id="alignmentControls" class="inspector-section alignment-controls">
          <div class="mini-heading"><strong>Align</strong><span>bounds + anchor</span></div>
          <div class="two-col">
            <label>Relative to<select id="alignTarget"><option value="canvas">Canvas</option><option value="safe">Safe area</option></select></label>
            <label>Align using<select id="alignReference"><option value="bounds">Object bounds</option><option value="anchor">Alignment anchor</option></select></label>
          </div>
          <div class="alignment-visuals">
            <div class="alignment-picker"><div class="alignment-picker-title"><span>Anchor</span><small id="alignAnchorName">Center</small></div><div id="alignAnchorGrid" class="align-nine-grid">{anchor_buttons}</div></div>
            <div class="alignment-picker"><div class="alignment-picker-title"><span>Place on frame</span><small>9-point</small></div><div id="alignPlaceGrid" class="align-nine-grid">{place_buttons}</div></div>
          </div>
          <p id="alignHelp" class="hint">Each placement button aligns the matching side, corner, or center of the current object bounds.</p>
        </div>'''
    html = replace_once(html, marker, block + marker, 'alignment inspector block')

# Cache bump all experiment resources.
html = re.sub(r'v=6\.1\.\d+', 'v=6.2.0', html)

# --- styling --------------------------------------------------------------------
if '/* Alignment system */' not in css:
    css += r'''

/* Alignment system */
.alignment-controls{padding-bottom:14px}
.alignment-visuals{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
.alignment-picker{min-width:0;padding:10px;border:1px solid rgba(34,72,120,.10);border-radius:12px;background:rgba(255,255,255,.45)}
.alignment-picker-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-size:11px;font-weight:650;color:#33445a}
.alignment-picker-title small{font-size:10px;font-weight:550;color:#8a98aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.align-nine-grid{display:grid;grid-template-columns:repeat(3,32px);grid-template-rows:repeat(3,32px);gap:4px;justify-content:center}
.align-point{--px:50%;--py:50%;position:relative;width:32px;height:32px;padding:0;border:1px solid rgba(45,79,122,.13);border-radius:8px;background:rgba(255,255,255,.72);box-shadow:0 1px 2px rgba(27,53,87,.04);cursor:pointer;transition:background .14s ease,border-color .14s ease,box-shadow .14s ease,transform .12s ease}
.align-point:hover{background:#fff;border-color:rgba(47,120,255,.32);box-shadow:0 3px 10px rgba(47,120,255,.09)}
.align-point:active{transform:scale(.94)}
.align-point.active{background:rgba(47,120,255,.11);border-color:rgba(47,120,255,.42);box-shadow:0 0 0 2px rgba(47,120,255,.08)}
.align-point span{position:absolute;inset:7px;border:1px solid rgba(61,82,108,.28);border-radius:3px;pointer-events:none}
.align-point span::after{content:"";position:absolute;left:var(--px);top:var(--py);width:4px;height:4px;border-radius:50%;background:#697b91;transform:translate(-50%,-50%);box-shadow:0 0 0 1.5px rgba(255,255,255,.9)}
.align-point.active span::after,.align-point.place:hover span::after{background:#2f78ff}
.align-point.place span::after{width:5px;height:5px;background:#445a73}
.align-point[data-point="tl"]{--px:0%;--py:0%}.align-point[data-point="tc"]{--px:50%;--py:0%}.align-point[data-point="tr"]{--px:100%;--py:0%}
.align-point[data-point="cl"]{--px:0%;--py:50%}.align-point[data-point="cc"]{--px:50%;--py:50%}.align-point[data-point="cr"]{--px:100%;--py:50%}
.align-point[data-point="bl"]{--px:0%;--py:100%}.align-point[data-point="bc"]{--px:50%;--py:100%}.align-point[data-point="br"]{--px:100%;--py:100%}
.alignment-controls>.hint{margin:10px 0 0;line-height:1.45}
@media(max-width:1100px){.alignment-visuals{grid-template-columns:1fr}.alignment-picker{display:grid;grid-template-columns:minmax(90px,1fr) auto;align-items:center;gap:10px}.alignment-picker-title{margin:0}.align-nine-grid{justify-content:end}}
'''

app_path.write_text(app)
html_path.write_text(html)
css_path.write_text(css)
