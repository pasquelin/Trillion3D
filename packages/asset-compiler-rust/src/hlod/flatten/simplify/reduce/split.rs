//! A wave's slabs and their welding back.
//!
//! The source bounds' major axis — the last of the longest extents — is cut into equal slabs from
//! the bounds' low side; a triangle goes to the slab its least corner along the axis falls in,
//! clamped to the slabs. Each slab keeps its triangles in mesh order and its vertices in the order
//! they first appear.
//!
//! Welding concatenates the simplified slabs. When any slab listed locked vertices, each of them
//! is mapped to the least id among the locked vertices at exactly its position, found in a table of
//! 1024 buckets keyed by the position's bits — so two positions equal under different bits weld
//! only when they share a bucket —; the triangles are renamed through the map and the vertices
//! they still name kept in the order they first name them.
use super::chains::{position_key, Chains};
use super::rounding::floor_i32;
use super::{Reference, Soup};
use crate::hlod::flatten::first_seen::first_seen;
use crate::hlod::flatten::simplify::sources::major_axis;
use crate::hlod::flatten::uv::extremes::least;
use rayon::prelude::*;
use trillion3d_math::vector::vecn::sub;

/// The bucket count of the table the locked vertices are welded through.
const WELD_BUCKETS: u32 = 1024;

/// `mesh` cut into `slabs` slabs across `reference`'s bounds.
pub(super) fn split(mesh: &Soup, reference: &Reference, slabs: usize) -> Vec<Soup> {
    let axis = major_axis(sub(reference.high, reference.low));
    let low = reference.low[axis];
    let per_length = slabs as f32 / (reference.high[axis] - low);
    let last = slabs as i32 - 1;
    let slab_of: Vec<usize> = (mesh.indices.par_chunks_exact(3))
        .map(|corners| {
            let along = |at: usize| mesh.vertices[corners[at] as usize].position[axis];
            let nearest = least(least(along(0), along(1)), along(2));
            floor_i32(per_length * (nearest - low)).min(last).max(0) as usize
        })
        .collect();
    let mut members = vec![Vec::new(); slabs];
    for (t, &slab) in slab_of.iter().enumerate() {
        members[slab].push(t);
    }
    (members.into_par_iter())
        .map(|triangles| {
            let named: Vec<u32> = (triangles.iter())
                .flat_map(|&t| mesh.indices[3 * t..3 * t + 3].iter().copied())
                .collect();
            let (kept, indices) = first_seen(named);
            Soup {
                vertices: kept.iter().map(|&v| mesh.vertices[v as usize]).collect(),
                indices,
            }
        })
        .collect()
}

/// The slabs, simplified, joined back into one mesh, `seams` listing each slab's locked vertices
/// by its own ids.
pub(super) fn weld(slabs: Vec<Soup>, seams: &[Vec<u32>]) -> Soup {
    let mut locked = Vec::new();
    let mut offset = 0u32;
    for (slab, seam) in slabs.iter().zip(seams) {
        locked.extend(seam.iter().map(|&v| offset + v));
        offset += slab.vertices.len() as u32;
    }
    let joined = concatenate(slabs);
    if locked.is_empty() {
        return joined;
    }
    let keys: Vec<u32> = (locked.par_iter())
        .map(|&v| position_key(joined.vertices[v as usize].position))
        .collect();
    let mut chains = Chains::new(WELD_BUCKETS, locked.len());
    for (&v, &key) in locked.iter().zip(&keys) {
        chains.add(key, v);
    }
    let twins: Vec<u32> = (locked.par_iter().zip(&keys))
        .map(|(&v, &key)| {
            let at = joined.vertices[v as usize].position;
            (chains.chain(key))
                .filter(|&w| w != v && joined.vertices[w as usize].position == at)
                .fold(v, u32::min)
        })
        .collect();
    let mut map: Vec<u32> = (0..joined.vertices.len() as u32).collect();
    for (&v, &twin) in locked.iter().zip(&twins) {
        map[v as usize] = twin;
    }
    let named: Vec<u32> = joined
        .indices
        .par_iter()
        .map(|&i| map[i as usize])
        .collect();
    let (kept, indices) = first_seen(named);
    Soup {
        vertices: kept.iter().map(|&v| joined.vertices[v as usize]).collect(),
        indices,
    }
}

/// The slabs one after the other, each slab's indices offset by the vertices before it.
fn concatenate(slabs: Vec<Soup>) -> Soup {
    let mut joined = Soup {
        vertices: Vec::with_capacity(slabs.iter().map(|s| s.vertices.len()).sum()),
        indices: Vec::with_capacity(slabs.iter().map(|s| s.indices.len()).sum()),
    };
    for slab in slabs {
        let offset = joined.vertices.len() as u32;
        joined
            .indices
            .extend(slab.indices.iter().map(|&i| offset + i));
        joined.vertices.extend(slab.vertices);
    }
    joined
}
