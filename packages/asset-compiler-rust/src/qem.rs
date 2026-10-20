//! What the region simplifier (`solve`, the one, `qem_solve.rs`) is handed: a region compacted from
//! the level's vertices, its vertex flags and its weighed attributes.
use trillion3d_page_codec::encode::vertices::first_use;
/// Region-local vertex buffer plus the table that maps a local index back to its source index:
/// the corners renumbered by first use, as a page's (`first_use`); a vertex past `positions` is
/// placed at the origin.
pub(crate) fn compact_region(positions: &[f32], indices: &[u32]) -> (Vec<f32>, Vec<u32>, Vec<u32>) {
    let (remap, compact_idx) = first_use(indices.iter().copied());
    let mut compact_pos = Vec::with_capacity(remap.len() * 3);
    for &source in &remap {
        let i = source as usize * 3;
        compact_pos.extend_from_slice(positions.get(i..i + 3).unwrap_or(&[0.0; 3]));
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
/// One per-vertex attribute counted in the simplification error: `width` floats per source
/// vertex, each weighted by `weight` in the simplifier's frame, where the mean triangle is a
/// quarter to a half of a unit across (`qem_solve.rs`).
#[derive(Clone, Copy)]
pub struct Attribute<'a> {
    pub values: &'a [f32],
    pub width: usize,
    pub weight: f32,
    pub role: Role,
}

/// What an attribute is to the simplifier: a normal is renormalised and a colour clamped after a
/// solve, a texture set marks its mirrored triangles (`qem_solve_prepare.rs`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    Normal,
    Color,
    Texture,
}

/// Where the attributes a solve corrects sit among a vertex's attribute floats: the normal's
/// three, renormalised — the pages draw unit normals, and a solved one is a blend —, and the
/// colour's, clamped to [0, 1], the range a page stores. The pages carry no tangent.
#[derive(Clone, Copy, Default)]
pub struct Corrected {
    pub normal: Option<usize>,
    pub color: Option<(usize, usize)>,
}
impl Corrected {
    /// The first normal and the first colour among `attributes`, by their floats' offsets.
    pub fn of(attributes: &[Attribute]) -> Self {
        let mut corrected = Self::default();
        let mut at = 0;
        for a in attributes {
            match a.role {
                Role::Normal if corrected.normal.is_none() => corrected.normal = Some(at),
                Role::Color if corrected.color.is_none() => corrected.color = Some((at, a.width)),
                _ => {}
            }
            at += a.width;
        }
        corrected
    }
    pub fn apply(&self, attributes: &mut [f32]) {
        if let Some(at) = self.normal {
            // A blend shorter than 1e-4 has no direction to keep: it stays as solved.
            let n = &mut attributes[at..at + 3];
            let square_sum = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
            if square_sum > 1e-8 {
                let scale = 1.0 / square_sum.sqrt();
                n.iter_mut().for_each(|x| *x *= scale);
            }
        }
        if let Some((at, width)) = self.color {
            for c in &mut attributes[at..at + width] {
                *c = c.clamp(0.0, 1.0);
            }
        }
    }
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
