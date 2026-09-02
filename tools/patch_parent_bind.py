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

# Rename the timestamp semantically from a start gate to a bind/reference frame,
# while migrating any saved parentStartMs produced by v6.1.3.
old_norm = "const out = { ...layer, parentId: layer.parentId || null, parentStartMs: layer.parentStartMs == null ? null : Math.max(0, num(layer.parentStartMs, 0)), base: { ...base, ...(layer.base||{}) } };"
new_norm = "const bindMs = layer.parentBindMs ?? layer.parentStartMs ?? null; const out = { ...layer, parentId: layer.parentId || null, parentBindMs: bindMs == null ? null : Math.max(0, num(bindMs, 0)), base: { ...base, ...(layer.base||{}) } }; delete out.parentStartMs;"
app = replace_once(app, old_norm, new_norm, 'normalize parent bind timestamp')

start = app.index('function parentPickupMs(layer) {')
end = app.index('function wouldCreateCycle(layerId, parentId) {', start)
new_parent_logic = r'''function parentBindMs(layer) {
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
'''
app = app[:start] + new_parent_logic + app[end:]

# Update inspector wording and helper function name.
app = app.replace('parentPickupMs(l)', 'parentBindMs(l)')
old_hint = "parentHint.textContent=!l.parentId?'':pickup==null?'Legacy parent relation. Reassign the parent at the desired timeline position to use pickup behavior.':`Follows ${model.layers[l.parentId]?.name||'parent'} from ${formatTime(pickup)}. Before that time this layer stays independent.`;"
new_hint = "parentHint.textContent=!l.parentId?'':pickup==null?'Legacy parent relation. Reassign the parent at the desired timeline position to create a bind pose.':`Bound to ${model.layers[l.parentId]?.name||'parent'} at ${formatTime(pickup)}. That frame is the reference pose; parenting applies across the full timeline.`;"
app = replace_once(app, old_hint, new_hint, 'parent bind inspector hint')

# Cache bump so Pages cannot pair the new HTML with the previous controller.
html = re.sub(r'v=6\.1\.3', 'v=6.1.4', html)

app_path.write_text(app)
html_path.write_text(html)
