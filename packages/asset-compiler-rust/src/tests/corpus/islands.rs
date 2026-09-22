//! The texture islands of a case, and the invariant they carry: a coarse triangle never spans two
//! of them, so no texture slides between two islands of a set.
use super::invariants::Built;
use super::*;
use std::collections::HashMap;

/// No coarse triangle spans two islands of a texture set. The limit: an island is a connected
/// component of the surface once the seams are cut, so a seam whose two sides stay connected
/// elsewhere — a sphere's or a cylinder's wrap column — is one island and a triangle across it
/// passes. What is caught is a coarse triangle whose corners lie in different islands.
pub(super) fn check_islands(case: &Case, indices: &[u32], built: &Built, label: &str) {
    for (name, uvs) in [("TEXCOORD_0", &case.uv0), ("TEXCOORD_1", &case.uv1)] {
        let Some(uvs) = uvs else { continue };
        let island = islands(&case.positions, uvs, indices);
        for cluster in built.dag.iter().filter(|c| c.level > 0) {
            for tri in cluster.indices.chunks(3) {
                let (a, b, c) = (
                    island[tri[0] as usize],
                    island[tri[1] as usize],
                    island[tri[2] as usize],
                );
                assert!(
                    a == b && b == c,
                    "{label}: a coarse triangle at level {} spans two {name} islands",
                    cluster.level
                );
            }
        }
    }
}

/// The island of every vertex: copies with the same position and texture coordinate are one
/// node, and a source triangle joins its corners.
fn islands(positions: &[f32], uvs: &[f32], indices: &[u32]) -> Vec<u32> {
    let count = positions.len() / 3;
    let mut parent: Vec<u32> = (0..count as u32).collect();
    fn find(parent: &mut [u32], mut v: u32) -> u32 {
        while parent[v as usize] != v {
            parent[v as usize] = parent[parent[v as usize] as usize];
            v = parent[v as usize];
        }
        v
    }
    let mut union = |a: u32, b: u32| {
        let (a, b) = (find(&mut parent, a), find(&mut parent, b));
        parent[a as usize] = b;
    };
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
        .map(f32::to_bits);
        match seen.get(&key) {
            Some(&first) => union(v, first),
            None => {
                seen.insert(key, v);
            }
        }
    }
    for tri in indices.chunks(3) {
        union(tri[0], tri[1]);
        union(tri[1], tri[2]);
    }
    (0..count as u32).map(|v| find(&mut parent, v)).collect()
}
