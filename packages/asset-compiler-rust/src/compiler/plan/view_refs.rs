//! Where a glTF object names a bufferView, read once for the plan and rewritten once for the scene.
use super::*;

/// Where `owner` names a bufferView, as `(pointer, label)`: its own when declared (`own` labels
/// it: an accessor's, an image's), and an accessor's sparse indices and values once it declares
/// `sparse`. The one list of where a view is named: the plan reads it, the scene rewrites it.
fn view_refs(owner: &Value, own: &'static str) -> [Option<(&'static str, &'static str)>; 3] {
    let sparse = owner.get("sparse").is_some();
    [
        owner.get("bufferView").map(|_| ("/bufferView", own)),
        sparse.then_some(("/sparse/indices/bufferView", "sparse.indices.bufferView")),
        sparse.then_some(("/sparse/values/bufferView", "sparse.values.bufferView")),
    ]
}

/// Visits every view `owner` names (`view_refs`), each required to be an index.
pub(crate) fn for_each_view_ref(
    owner: &Value,
    own: &'static str,
    mut visit: impl FnMut(usize),
) -> Result<()> {
    for (pointer, label) in view_refs(owner, own).into_iter().flatten() {
        visit(required_index(owner.pointer(pointer), label)?);
    }
    Ok(())
}

/// Renames every view `owner` names (`view_refs`) to its rank in the compacted buffer, `map`.
pub(crate) fn remap_view_refs(
    owner: &mut Value,
    own: &'static str,
    map: &BTreeMap<usize, usize>,
) -> Result<()> {
    for (pointer, label) in view_refs(owner, own).into_iter().flatten() {
        let old = required_index(owner.pointer(pointer), label)?;
        let new = *map
            .get(&old)
            .ok_or_else(|| invalid(format!("{label} is not in the compacted buffer")))?;
        if let Some(slot) = owner.pointer_mut(pointer) {
            *slot = json!(new);
        }
    }
    Ok(())
}
