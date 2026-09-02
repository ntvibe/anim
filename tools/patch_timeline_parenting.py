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

# Preserve the timestamp at which a modern parent relation starts.
app = replace_once(
    app,
    "const out = { ...layer, parentId: layer.parentId || null, base: { ...base, ...(layer.base||{}) } };",
    "const out = { ...layer, parentId: layer.parentId || null, parentStartMs: layer.parentStartMs == null ? null : Math.max(0, num(layer.parentStartMs, 0)), base: { ...base, ...(layer.base||{}) } };",
    'normalize parent pickup timestamp'
)

parent_block = re.compile(
    r"function worldMatrix\(layerId, ms, seen = new Set\(\)\) \{.*?\n\}\n"
    r"function worldOpacity\(layerId, ms, seen = new Set\(\)\) \{.*?\n\}\n"
    r"function reparentLayer\(layerId, newParentId\) \{.*?\n\}\n",
    re.S,
)
new_parent_block = r'''function parentPickupMs(layer) {
  return layer?.parentStartMs == null ? null : Math.max(0, num(layer.parentStartMs, 0));
}
function worldMatrix(layerId, ms, seen = new Set()) {
  const layer = model.layers[layerId]; if (!layer || seen.has(layerId)) return [1,0,0,1,0,0];
  seen.add(layerId);
  const local = matFromTransform(localTransformAt(layer, ms));
  if (!layer.parentId || !model.layers[layer.parentId]) return local;
  const pickup = parentPickupMs(layer);
  if (pickup == null) return matMul(worldMatrix(layer.parentId, ms, new Set(seen)), local);
  if (ms <= pickup) return local;
  const parentNow = worldMatrix(layer.parentId, ms, new Set(seen));
  const parentAtPickup = worldMatrix(layer.parentId, pickup, new Set(seen));
  const parentDelta = matMul(parentNow, matInv(parentAtPickup));
  return matMul(parentDelta, local);
}
function worldOpacity(layerId, ms, seen = new Set()) {
  const layer = model.layers[layerId]; if (!layer || seen.has(layerId)) return 1;
  seen.add(layerId);
  const own = localTransformAt(layer, ms).opacity;
  if (!layer.parentId || !model.layers[layer.parentId]) return own;
  const pickup = parentPickupMs(layer);
  if (pickup == null) return own * worldOpacity(layer.parentId, ms, new Set(seen));
  if (ms <= pickup) return own;
  const parentNow = worldOpacity(layer.parentId, ms, new Set(seen));
  const parentAtPickup = worldOpacity(layer.parentId, pickup, new Set(seen));
  const parentFactor = parentAtPickup > 1e-6 ? parentNow / parentAtPickup : 1;
  return own * parentFactor;
}
function parentInfluenceAt(layer, ms) {
  if (!layer.parentId || !model.layers[layer.parentId]) return { matrix: [1,0,0,1,0,0], opacity: 1 };
  const pickup = parentPickupMs(layer);
  if (pickup == null) return { matrix: worldMatrix(layer.parentId, ms), opacity: worldOpacity(layer.parentId, ms) };
  if (ms <= pickup) return { matrix: [1,0,0,1,0,0], opacity: 1 };
  const parentNow = worldMatrix(layer.parentId, ms);
  const parentAtPickup = worldMatrix(layer.parentId, pickup);
  const opacityNow = worldOpacity(layer.parentId, ms);
  const opacityAtPickup = worldOpacity(layer.parentId, pickup);
  return {
    matrix: matMul(parentNow, matInv(parentAtPickup)),
    opacity: opacityAtPickup > 1e-6 ? opacityNow / opacityAtPickup : 1,
  };
}
function bakeCurrentParentInfluence(layer, ms) {
  const influence = parentInfluenceAt(layer, ms);
  const bake = (value) => {
    const baked = decompose(matMul(influence.matrix, matFromTransform(value)), clamp(value.opacity * influence.opacity, 0, 1));
    return baked;
  };
  layer.base = bake(layer.base);
  layer.transform.from = bake(layer.transform.from);
  layer.transform.to = bake(layer.transform.to);
}
function reparentLayer(layerId, newParentId) {
  const layer = model.layers[layerId]; if (!layer) return;
  const nextParentId = newParentId || null;
  if (nextParentId === layer.parentId) return;
  const rawPickup = playhead * durationMs();
  const pickup = Math.max(0, model.snap ? snapMs(rawPickup) : rawPickup);
  if (layer.parentId && model.layers[layer.parentId]) bakeCurrentParentInfluence(layer, pickup);
  layer.parentId = null;
  layer.parentStartMs = null;
  if (nextParentId && model.layers[nextParentId]) {
    layer.parentId = nextParentId;
    layer.parentStartMs = pickup;
  }
}
'''
app, count = parent_block.subn(new_parent_block, app, count=1)
if count != 1:
    raise SystemExit(f'Expected one parenting block, replaced {count}')

# Explain pickup timing in the inspector when a modern parent relationship is active.
app = replace_once(
    app,
    "$('parentLayer').innerHTML=parentOptions(l);$('parentLayer').value=l.parentId||'';",
    "$('parentLayer').innerHTML=parentOptions(l);$('parentLayer').value=l.parentId||'';const parentHint=$('parentPickupHint');if(parentHint){const pickup=parentPickupMs(l);parentHint.hidden=!l.parentId;parentHint.textContent=!l.parentId?'':pickup==null?'Legacy parent relation. Reassign the parent at the desired timeline position to use pickup behavior.':`Follows ${model.layers[l.parentId]?.name||'parent'} from ${formatTime(pickup)}. Before that time this layer stays independent.`;}",
    'parent pickup hint sync'
)

# Replace timeline pointer behavior so ruler/playhead/blank track all scrub like an app.
setup_pattern = re.compile(r"function setupTimeline\(\)\{.*?\n\}\nfunction setupCanvasBindings\(\)\{", re.S)
new_setup = r'''function timelineTrackRect(){const track=document.querySelector('.timing-track');return track?.getBoundingClientRect()||null;}
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
function setupCanvasBindings(){'''
app, count = setup_pattern.subn(new_setup, app, count=1)
if count != 1:
    raise SystemExit(f'Expected one setupTimeline block, replaced {count}')

# Make the top strip status-only and relocate all playback/timeline controls directly above the timeline.
start = html.find('    <div class="viewport-toolbar">')
end = html.find('    <div class="stage-shell">', start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate viewport toolbar block')
new_toolbar = '''    <div class="viewport-toolbar">
      <div class="viewport-left"><strong>Animation Studio</strong><span id="canvasReadout">800 × 450</span><span id="saveStatus" class="save-status">Autosaved</span></div>
    </div>

'''
html = html[:start] + new_toolbar + html[end:]

transport = '''      <div class="timeline-transport">
        <div class="transport-left"><button id="restartBtn" class="icon-button" title="Start">↤</button><button id="prevFrameBtn" class="icon-button" title="Previous frame">‹</button><button id="playBtn" class="play-button"><span>Play</span></button><button id="nextFrameBtn" class="icon-button" title="Next frame">›</button><div class="time-cluster"><span id="timeReadout">0.00 s</span><span>/</span><span id="totalTimeReadout">2.07 s</span></div></div>
        <input id="scrubber" type="range" min="0" max="1" step="0.001" value="0" aria-label="Timeline playhead" />
        <div class="transport-right"><button id="loopBtn" class="icon-button active" title="Loop (L)">↻</button><button id="snapBtn" class="micro-toggle active">Snap</button><button id="undoBtn" class="icon-button" title="Undo">↶</button><button id="redoBtn" class="icon-button" title="Redo">↷</button><button id="resetBtn" class="reset-button">Reset</button></div>
      </div>
'''
html = replace_once(html, '    <section class="timeline-panel">\n', '    <section class="timeline-panel">\n' + transport, 'insert timeline transport')
html = replace_once(
    html,
    '<div class="timeline-actions"><button id="addTextBtn" class="add-layer">+ Text</button><button id="addImageBtn" class="add-layer">+ Image</button><button id="addNullBtn" class="add-layer">+ Null</button><button id="snapBtn" class="micro-toggle active">Snap</button></div>',
    '<div class="timeline-actions"><button id="addTextBtn" class="add-layer">+ Text</button><button id="addImageBtn" class="add-layer">+ Image</button><button id="addNullBtn" class="add-layer">+ Null</button></div>',
    'remove duplicate snap from timeline head'
)
html = replace_once(
    html,
    '<div class="two-col"><label>Parent<select id="parentLayer"></select></label><label>&nbsp;<button id="deleteLayerBtn" class="danger-button">Delete layer</button></label></div>',
    '<div class="two-col"><label>Parent<select id="parentLayer"></select></label><label>&nbsp;<button id="deleteLayerBtn" class="danger-button">Delete layer</button></label></div><p id="parentPickupHint" class="hint parent-pickup-hint" hidden></p>',
    'parent pickup hint markup'
)
html = re.sub(r'v=6\.1\.\d+', 'v=6.1.3', html)

# Late overrides keep the visual pass isolated and make timeline interaction feel native/app-like.
overrides = r'''

/* Timeline transport + app-like scrubbing */
.workspace{grid-template-rows:42px minmax(250px,1fr) minmax(270px,40%)}
.viewport-toolbar{justify-content:flex-start;padding:0 13px}
.timeline-panel{display:grid;grid-template-rows:42px 34px minmax(0,1fr);padding:8px 12px 12px}
.timeline-transport{min-width:0;display:flex;align-items:center;gap:8px;padding-bottom:7px;border-bottom:1px solid rgba(118,140,170,.1)}
.transport-left,.transport-right{display:flex;align-items:center;gap:6px;min-width:0}
.timeline-transport #scrubber{flex:1;max-width:none;min-width:110px}
.timeline-head{height:auto}
.timeline-grid{height:auto;min-height:0}
.timeline-panel,.timeline-panel *{-webkit-user-select:none;user-select:none}
.timeline-ruler,.timeline,.timing-track,.timeline-playhead{touch-action:none}
.timeline-ruler{cursor:ew-resize}
.timeline-playhead{width:2px;pointer-events:auto;cursor:ew-resize;box-shadow:0 0 0 1px rgba(47,120,255,.04)}
.timeline-playhead::before{content:"";position:absolute;left:-7px;right:-7px;top:0;bottom:0}
.timeline-playhead::after{content:"";position:absolute;left:50%;top:0;width:8px;height:8px;background:var(--accent);border-radius:2px;transform:translate(-50%,-45%) rotate(45deg);box-shadow:0 2px 5px rgba(47,120,255,.18)}
body.timeline-interacting,body.timeline-interacting *{-webkit-user-select:none!important;user-select:none!important}
body.timeline-interacting .timeline,body.timeline-interacting .timeline-ruler,body.timeline-interacting .timing-track{cursor:ew-resize}
.parent-pickup-hint{padding:7px 9px;border-radius:9px;background:rgba(47,120,255,.055);color:#6f82a0}
@media(max-width:1050px){.timeline-transport #scrubber{min-width:80px}.transport-right{gap:4px}}
@media(max-width:820px){.timeline-panel{grid-template-rows:auto 34px minmax(0,1fr)}.timeline-transport{flex-wrap:wrap}.timeline-transport #scrubber{order:3;flex-basis:100%;min-width:100%}.transport-left,.transport-right{flex:1}.transport-right{justify-content:flex-end}}
'''
if '/* Timeline transport + app-like scrubbing */' not in css:
    css += overrides

app_path.write_text(app)
html_path.write_text(html)
css_path.write_text(css)

# Fast structural checks before CI does syntax validation.
assert 'parentStartMs' in app
assert 'beginTimelineScrub' in app
assert 'timeline-interacting' in app
assert 'class="viewport-actions"' not in html
assert html.count('id="playBtn"') == 1
assert html.count('id="snapBtn"') == 1
assert html.count('id="scrubber"') == 1
assert 'parentPickupHint' in html
