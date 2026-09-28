//! The texture islands of a case, and the invariant they carry: a coarse triangle a pixel shows
//! never spans two of them, so no texture slides between two islands of a set.
use super::invariants::Built;
use super::*;
use crate::join::Join;
use crate::shared_math::{length, point, sub};
use std::collections::HashMap;

/// No coarse triangle a pixel shows spans two islands of a texture set: one whose corners lie in
/// two islands is no longer than its cluster's error, so wherever the cut draws it, it covers
/// under a pixel. A vertex a solve placed lies in the island of the source vertex it was solved
/// from. The limit: an island is a connected component of the surface once the seams are cut, so
/// a seam whose two sides stay connected elsewhere — a sphere's or a cylinder's wrap column — is
/// one island and a triangle across it passes.
pub(super) fn check_islands(case: &Case, indices: &[u32], built: &Built, label: &str) {
    let source = case.vertex_count();
    let origin = |v: u32| match (v as usize).checked_sub(source) {
        Some(placed) => built.grown.as_ref().expect("grown").origin[placed],
        None => v,
    };
    let positions = built.positions(case);
    for (name, uvs) in case.uv_sets() {
        let island = islands(&case.positions, uvs, indices);
        for cluster in built.dag.iter().filter(|c| c.level > 0) {
            for tri in cluster.indices.as_chunks::<3>().0 {
                let [a, b, c] = tri.map(|v| island[origin(v) as usize]);
                let [p, q, r] = tri.map(|v| point(positions, v));
                let longest = length(sub(q, p))
                    .max(length(sub(r, q)))
                    .max(length(sub(p, r)));
                assert!(
                    (a == b && b == c) || longest <= cluster.lod_error,
                    "{label}: a coarse triangle at level {} spans two {name} islands",
                    cluster.level
                );
            }
        }
    }
}

/// The island of every vertex: copies with the same position and texture coordinate are one
/// node, and a source triangle joins its corners. Adding `+0.0` folds `-0.0` onto `+0.0` before
/// the bits are read, so a coordinate equal to zero is one key whatever its sign.
fn islands(positions: &[f32], uvs: &[f32], indices: &[u32]) -> Vec<u32> {
    let count = positions.len() / 3;
    let mut join = Join::new(count);
    let mut seen: HashMap<[u32; 5], u32> = HashMap::new();
    for &v in indices {
        let (p, t) = (v as usize * 3, v as usize * 2);
        let key = [
            positions[p],
            positions[p + 1],
            positions[p + 2],
            uvs[t],
            uvs[t + 1],
        ]
        .map(|value| (value + 0.0).to_bits());
        let first = *seen.entry(key).or_insert(v);
        join.unite(v, first);
    }
    for tri in indices.chunks(3) {
        join.unite(tri[0], tri[1]);
        join.unite(tri[1], tri[2]);
    }
    (0..count as u32).map(|v| join.root(v)).collect()
}
