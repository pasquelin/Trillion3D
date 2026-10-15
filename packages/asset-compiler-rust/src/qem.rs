//! What the region simplifier (`solve`, the one, `qem_solve.rs`) is handed: a region compacted from
//! the level's vertices, its vertex flags and its weighed attributes.
use trillion3d_page_codec::hash::word_map;
/// Region-local vertex buffer plus the table that maps a local index back to its source index,
/// renumbered through one hash map sized by the region's corners, whatever the mesh around it.
pub(crate) fn compact_region(positions: &[f32], indices: &[u32]) -> (Vec<f32>, Vec<u32>, Vec<u32>) {
    let vertex_count = positions.len() / 3;
    // Region cannot renumber more vertices than corners or mesh
    // contains: both lists start at bound instead of doubling en route.
    let bound = indices.len().min(vertex_count.max(1));
    let mut compact_pos = Vec::with_capacity(bound * 3);
    let mut remap = Vec::with_capacity(bound);
    let mut compact_idx = Vec::with_capacity(indices.len());
    let push = |source: u32, compact_pos: &mut Vec<f32>, remap: &mut Vec<u32>| {
        let i = source as usize * 3;
        if i + 2 < positions.len() {
            compact_pos.extend_from_slice(&positions[i..i + 3]);
        } else {
            compact_pos.extend_from_slice(&[0.0, 0.0, 0.0]);
        }
        remap.push(source);
    };
    let mut map = word_map(indices.len());
    for &source in indices {
        let id = match map.get(&source) {
            Some(&id) => id,
            None => {
                let id = remap.len() as u32;
                map.insert(source, id);
                push(source, &mut compact_pos, &mut remap);
                id
            }
        };
        compact_idx.push(id);
    }
    (compact_pos, compact_idx, remap)
}
/// The region of `corners` with each position welded to its first copy by bits
/// (`weld_positions`), then compacted: its positions, its corners renumbered, and its corners
/// welded in the source numbering. The one sequence a soft body's page ids, its simulation
/// vertices and a convex hull read, so the page and the simulation name the same vertices by
/// construction.
pub(crate) fn welded_region(positions: &[f32], corners: &[u32]) -> (Vec<f32>, Vec<u32>, Vec<u32>) {
    let canonical = crate::dag::clusters::weld_positions(positions, corners);
    let welded: Vec<u32> = corners.iter().map(|&i| canonical[i as usize]).collect();
    let (xyz, local, _) = compact_region(positions, &welded);
    (xyz, local, welded)
}
/// The simplifier's per-vertex flags: the vertex does not move.
pub const VERTEX_LOCK: u8 = 1;
/// The vertex keeps its attribute discontinuity (a texture seam) under permissive mode.
pub const VERTEX_PROTECT: u8 = 2;

/// One per-vertex attribute counted in the simplification error: `width` floats per source
/// vertex, each weighted by `weight` against the positions normalised to the region's extent.
#[derive(Clone, Copy)]
pub struct Attribute<'a> {
    pub values: &'a [f32],
    pub width: usize,
    pub weight: f32,
}

/// Vertex `source`'s `width` values of `values`, appended to `out`: the one compaction of an
/// attribute. Every producer carries an attribute on every vertex: a vertex missing from one is a
/// cook defect, refused here by the index rather than drawn black or flat.
pub(crate) fn push_vertex(out: &mut Vec<f32>, values: &[f32], width: usize, source: u32) {
    let at = source as usize * width;
    out.extend_from_slice(&values[at..at + width]);
}

/// The attributes of the region's vertices, interleaved in compact order, and one weight per float.
pub(crate) fn compact_attributes(attributes: &[Attribute], remap: &[u32]) -> (Vec<f32>, Vec<f32>) {
    let weights: Vec<f32> = attributes
        .iter()
        .flat_map(|a| std::iter::repeat_n(a.weight, a.width))
        .collect();
    let mut values = Vec::with_capacity(remap.len() * weights.len());
    for &source in remap {
        for a in attributes {
            push_vertex(&mut values, a.values, a.width, source);
        }
    }
    (values, weights)
}
#[cfg(test)]
#[path = "qem_attribute_tests.rs"]
mod attribute_tests;
/// The region simplifier.
#[path = "qem_solve.rs"]
pub(crate) mod solve;
#[cfg(test)]
#[path = "qem_tests.rs"]
mod tests;
