//! Border of a reduced group: what must survive simplification so two neighbouring
//! groups still meet, and what is locked extra when they do not.

/// Triangles whose three corners differ. A triangle with two coinciding corners —
/// two copies of the same position, once welded — has no area: meshoptimizer
/// drops it, and a vertex that existed only there is not a lost border (measured:
/// 238 triangles of 2 465 in a group, and the three "lost" locks that blocked its
/// retry had no live triangle).
pub(super) fn live_triangles(indices: impl Iterator<Item = u32>) -> Vec<u32> {
    let mut out: Vec<u32> = indices.collect();
    let mut kept = 0usize;
    for tri in 0..out.len() / 3 {
        let (a, b, c) = (out[tri * 3], out[tri * 3 + 1], out[tri * 3 + 2]);
        if a != b && b != c && a != c {
            out.copy_within(tri * 3..tri * 3 + 3, kept);
            kept += 3;
        }
    }
    out.truncate(kept);
    out
}

/// Locks, welded, the three corners of every `source` triangle of which a corner
/// is welded to one of `lost`; `extra` stays sorted and duplicate-free for the
/// lock's binary search.
pub(super) fn lock_triangles_touching(
    source: &[u32],
    lost: &[u32],
    weld: &[u32],
    extra: &mut Vec<u32>,
) {
    for tri in source.as_chunks::<3>().0 {
        if tri
            .iter()
            .any(|&id| lost.binary_search(&weld[id as usize]).is_ok())
        {
            extra.extend(tri.iter().map(|&id| weld[id as usize]));
        }
    }
    extra.sort_unstable();
    extra.dedup();
}

/// Locked vertices of `merged`, welded, sorted, duplicate-free: those that any
/// reduction of the group must keep to still meet its neighbours. Independent of
/// the reduction, so computed once per group, not at each retry.
pub(super) fn required_locks(merged: &[u32], locks: &[bool], weld: &[u32]) -> Vec<u32> {
    let mut required: Vec<u32> = merged
        .iter()
        .filter(|&&id| locks.get(id as usize).copied().unwrap_or(false))
        .map(|&id| weld[id as usize])
        .collect();
    required.sort_unstable();
    required.dedup();
    required
}

/// Those in `required` that `simplified` no longer carries. Empty when every vertex shared with another
/// group survived — otherwise the two groups no longer meet. A corner naming a vertex the
/// reduction created (`NEW_VERTEX`) is outside the weld table and counts for no lock: a locked
/// vertex is never moved, so it survives under its own index or not at all.
///
/// Two sorted lists and a merge replace the previous two `HashSet`s: same question asked,
/// same answer, without hashing tens of thousands of corners twice.
pub(super) fn lost_locks(required: &[u32], simplified: &[u32], weld: &[u32]) -> Vec<u32> {
    if required.is_empty() {
        return Vec::new();
    }
    let mut kept: Vec<u32> = simplified
        .iter()
        .filter_map(|&id| weld.get(id as usize).copied())
        .collect();
    kept.sort_unstable();
    kept.dedup();
    let mut at = 0usize;
    required
        .iter()
        .copied()
        .filter(|&id| {
            while kept.get(at).is_some_and(|value| *value < id) {
                at += 1;
            }
            kept.get(at) != Some(&id)
        })
        .collect()
}

/// Every vertex shared with another group must survive, or the two groups no longer meet.
#[cfg(test)]
pub(crate) fn border_survived(
    merged: &[u32],
    simplified: &[u32],
    locks: &[bool],
    weld: &[u32],
) -> bool {
    lost_locks(&required_locks(merged, locks, weld), simplified, weld).is_empty()
}
