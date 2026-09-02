from pathlib import Path
import re

root = Path('experiments/01-bezier-logo-text')
app_path = root / 'app.js'
html_path = root / 'index.html'
app = app_path.read_text()
html = html_path.read_text()


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Pattern not found: {label}')
    return text.replace(old, new, 1)

# Persist an actual parent-world snapshot captured at bind time. The timestamp remains
# metadata/migration context, but runtime parenting is never gated by time.
old_norm = "const bindMs = layer.parentBindMs ?? layer.parentStartMs ?? null; const out = { ...layer, parentId: layer.parentId || null, parentBindMs: bindMs == null ? null : Math.max(0, num(bindMs, 0)), base: { ...base, ...(layer.base||{}) } }; delete out.parentStartMs;"
new_norm = "const bindMs = layer.parentBindMs ?? layer.parentStartMs ?? null; const bindMatrix = Array.isArray(layer.parentBindMatrix) && layer.parentBindMatrix.length === 6 ? layer.parentBindMatrix.map(Number) : null; const out = { ...layer, parentId: layer.parentId || null, parentBindMs: bindMs == null ? null : Math.max(0, num(bindMs, 0)), parentBindMatrix: bindMatrix, parentBindOpacity: layer.parentBindOpacity == null ? null : num(layer.parentBindOpacity, 1), base: { ...base, ...(layer.base||{}) } }; delete out.parentStartMs;"
app = replace_once(app, old_norm, new_norm, 'normalize bind snapshot')

start = app.index('function parentBindMs(layer) {')
end = app.index('function wouldCreateCycle(layerId, parentId) {', start)
new_parent_logic = r'''function parentBindMs(layer) {
  return layer?.parentBindMs == null ? null : Math.max(0, num(layer.parentBindMs, 0));
}
function validBindMatrix(layer) {
  return Array.isArray(layer?.parentBindMatrix) && layer.parentBindMatrix.length === 6 && layer.parentBindMatrix.every(Number.isFinite);
}
function captureMissingBindReference(layer, seen = new Set()) {
  if (!layer?.parentId || !model.layers[layer.parentId]) return null;
  if (validBindMatrix(layer)) return { matrix: layer.parentBindMatrix, opacity: layer.parentBindOpacity == null ? 1 : num(layer.parentBindOpacity, 1) };
  const bind = parentBindMs(layer);
  if (bind == null) return null;
  // Upgrade existing v6.1.4 saves lazily: capture the parent's actual world pose once.
  const matrix = worldMatrix(layer.parentId, bind, new Set(seen));
  const opacity = worldOpacity(layer.parentId, bind, new Set(seen));
  layer.parentBindMatrix = [...matrix];
  layer.parentBindOpacity = opacity;
  scheduleSave();
  return { matrix: layer.parentBindMatrix, opacity };
}
function worldMatrix(layerId, ms, seen = new Set()) {
  const layer = model.layers[layerId]; if (!layer || seen.has(layerId)) return [1,0,0,1,0,0];
  seen.add(layerId);
  const local = matFromTransform(localTransformAt(layer, ms));
  if (!layer.parentId || !model.layers[layer.parentId]) return local;
  const parentNow = worldMatrix(layer.parentId, ms, new Set(seen));
  const reference = captureMissingBindReference(layer, new Set(seen));
  // Legacy relationships without any bind metadata keep direct-parent behavior.
  if (!reference) return matMul(parentNow, local);
  // Parenting is active for the ENTIRE timeline. The stored bind matrix is only the
  // neutral coordinate basis, so parent motion before and after the bind frame applies.
  return matMul(matMul(parentNow, matInv(reference.matrix)), local);
}
function worldOpacity(layerId, ms, seen = new Set()) {
  const layer = model.layers[layerId]; if (!layer || seen.has(layerId)) return 1;
  seen.add(layerId);
  const own = localTransformAt(layer, ms).opacity;
  if (!layer.parentId || !model.layers[layer.parentId]) return own;
  const parentNow = worldOpacity(layer.parentId, ms, new Set(seen));
  const reference = captureMissingBindReference(layer, new Set(seen));
  if (!reference) return own * parentNow;
  const factor = reference.opacity > 1e-6 ? parentNow / reference.opacity : 1;
  return own * factor;
}
function parentInfluenceAt(layer, ms) {
  if (!layer.parentId || !model.layers[layer.parentId]) return { matrix: [1,0,0,1,0,0], opacity: 1 };
  const parentNow = worldMatrix(layer.parentId, ms);
  const opacityNow = worldOpacity(layer.parentId, ms);
  const reference = captureMissingBindReference(layer);
  if (!reference) return { matrix: parentNow, opacity: opacityNow };
  return {
    matrix: matMul(parentNow, matInv(reference.matrix)),
    opacity: reference.opacity > 1e-6 ? opacityNow / reference.opacity : 1,
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
  // Preserve the current visual pose when leaving/changing an existing parent.
  if (layer.parentId && model.layers[layer.parentId]) bakeCurrentParentInfluence(layer, bind);
  layer.parentId = null;
  layer.parentBindMs = null;
  layer.parentBindMatrix = null;
  layer.parentBindOpacity = null;
  if (nextParentId && model.layers[nextParentId]) {
    // Capture the parent basis BEFORE assigning it to this child. This is a fixed snapshot,
    // not a time gate: movement on both sides of the bind frame is inherited.
    const bindMatrix = worldMatrix(nextParentId, bind, new Set([layerId]));
    const bindOpacity = worldOpacity(nextParentId, bind, new Set([layerId]));
    layer.parentId = nextParentId;
    layer.parentBindMs = bind;
    layer.parentBindMatrix = [...bindMatrix];
    layer.parentBindOpacity = bindOpacity;
  }
}
'''
app = app[:start] + new_parent_logic + app[end:]

# Make the inspector wording explicit about motion on both sides of the reference frame.
old_hint = "parentHint.textContent=!l.parentId?'':pickup==null?'Legacy parent relation. Reassign the parent at the desired timeline position to create a bind pose.':`Bound to ${model.layers[l.parentId]?.name||'parent'} at ${formatTime(pickup)}. That frame is the reference pose; parenting applies across the full timeline.`;"
new_hint = "parentHint.textContent=!l.parentId?'':pickup==null?'Legacy parent relation. Reassign the parent at the desired timeline position to create a bind pose.':`Bound to ${model.layers[l.parentId]?.name||'parent'} at ${formatTime(pickup)}. This is only the reference pose; parent motion before and after this frame is included.`;"
app = replace_once(app, old_hint, new_hint, 'bind hint')

# Cache bump all editor assets/controller references.
html = re.sub(r'v=6\.1\.4', 'v=6.1.5', html)

app_path.write_text(app)
html_path.write_text(html)
