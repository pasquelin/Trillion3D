//! What a collapse may not do to a texture: the per-vertex flags the whole build carries.
//!
//! Two ways a chart breaks, and they are not the same defect.
//!
//! **A seam** is two copies of one position carrying different coordinates. meshoptimizer reads
//! it as a wedge (Hoppe 1999) and, told to keep it, slides the collapse along the seam instead
//! of across it: `PROTECT`, which is only meaningful on a vertex it already sees as a seam.
//!
//! **A mirrored island** carries no such copy. Its two halves meet on vertices holding the
//! *same* coordinate, the parameterisation only reversing its orientation across the edge, so
//! the simplifier sees one ordinary manifold edge and may collapse across it — folding the
//! texture onto itself, while the attribute quadric raises no objection: the collapsed vertex
//! keeps a coordinate both halves agree on. There is no wedge to protect there, so the only
//! thing that keeps the fold shut is `LOCK`, and the declared cost is that a mirror line keeps
//! its source resolution at every level. Splitting those vertices into a real seam would work
//! as well and would grow the vertex buffer, which this strategy does not do.
//!
//! The fold shows in the sign of the parameterisation, the sign of the determinant
//! `attributes.rs` already solves: positive on one half, negative on the other. An edge whose
//! triangles disagree on it is a mirror edge. Read off the object's own coordinates, both ways;
//! nothing here is a threshold.
use super::*;
use crate::qem_attributes::{LOCK, PROTECT};

/// Simplifier flags per source vertex: `PROTECT` on a texture seam of either set, `LOCK` on the
/// ends of a mirror edge of either set. A level ORs its own group-border locks into them.
pub(super) fn vertex_flags(vertices: &DagVertices<'_>, indices: &[u32], welds: &Welds) -> Vec<u8> {
    let weld: &[u32] = &welds.position;
    let mut folded = vec![false; weld.len()];
    for flag in attributes::TEXTURE_FLAGS {
        let Some(set) = attributes::texture_set(vertices.attributes, flag) else {
            continue;
        };
        mark_mirror_edges(&set.values, indices, weld, &mut folded);
    }
    welds
        .texture_seams()
        .into_iter()
        .enumerate()
        .map(|(vertex, seam)| {
            (u8::from(seam) * PROTECT) | (u8::from(folded[weld[vertex] as usize]) * LOCK)
        })
        .collect()
}

/// Flags, by welded position, the ends of every edge two triangles parameterise in opposite
/// orientations. An edge more than two triangles share is read the same way: any disagreement
/// with the orientation first seen on it is a fold.
fn mark_mirror_edges(uvs: &[f32], indices: &[u32], weld: &[u32], folded: &mut [bool]) {
    let mut seen: HashMap<(u32, u32), bool> = HashMap::with_capacity(indices.len());
    for corners in indices.as_chunks::<3>().0 {
        let uv = [0, 1, 2].map(|c| attributes::texel(uvs, corners[c]));
        let Some(determinant) = attributes::uv_determinant(&uv) else {
            continue;
        };
        let positive = determinant > 0.0;
        for c in 0..3 {
            let ends = [c, (c + 1) % 3].map(|e| weld[corners[e] as usize]);
            let edge = (ends[0].min(ends[1]), ends[0].max(ends[1]));
            if seen.insert(edge, positive) == Some(!positive) {
                folded[edge.0 as usize] = true;
                folded[edge.1 as usize] = true;
            }
        }
    }
}
