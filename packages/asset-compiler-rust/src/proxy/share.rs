//! Lossless instance proxy sharing: no placed triangle or albedo bit changes.
//!
//! World simplification runs first. Afterwards a placement whose simplified
//! triangles are another's carried by one affine map, bit for bit in the reader's own arithmetic,
//! stores only that map and the flat position of each of its triangles; every other placement
//! stays flat. The reader expands the shared runs back into the flat layout.
use super::PROXY_TRIANGLE_FLOATS;
use crate::compiler_world::{cofactor_direction, Mat4};
use crate::shared_math::linear_columns;
use std::collections::BTreeMap;
use trillion3d_math::linear::determinant;
use trillion3d_math::matrix::transform_point_3x4_f32;

/// Numbers per stored map: three rows of a 3×4 affine matrix, row-major.
pub const PROXY_TRANSFORM_FLOATS: usize = 12;
/// Prototypes one placement is tried against before it stays flat: a failed try stops at its
/// first differing vertex, and the bound keeps a scene of unrelated same-size runs linear.
const TRIES: usize = 8;
/// The map that leaves a shape where it is.
const IDENTITY: [f32; 12] = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0];
/// Words a shared placement costs besides its positions: shape index and map.
const INSTANCE_WORDS: usize = 1 + PROXY_TRANSFORM_FLOATS;
/// Words a flat triangle costs: its vertices and its albedo.
const TRIANGLE_WORDS: usize = PROXY_TRIANGLE_FLOATS + 1;

/// What the file stores besides its flat triangles.
#[derive(Default)]
pub struct Sharing {
    /// Per shape: the flat positions of its prototype's triangles, stored once as the shape.
    pub shapes: Vec<Vec<u32>>,
    /// Per shared placement: its shape and the map placing the shape.
    pub instances: Vec<(u32, [f32; PROXY_TRANSFORM_FLOATS])>,
    /// Flat position of each placed shape triangle, placement after placement.
    pub positions: Vec<u32>,
}

/// Map from `a`'s run to `b`'s: linear part `B·A⁻¹` rounded to whole numbers, since snapping to
/// the world grid commutes with signed axis permutations only; translation from the first vertices.
fn map(a: &Mat4, b: &Mat4, a0: &[f32], b0: &[f32]) -> Option<[f32; 12]> {
    let det = determinant(a);
    if !(det.is_finite() && det != 0.0) {
        return None;
    }
    let columns = linear_columns(b);
    let mut m = [0f32; PROXY_TRANSFORM_FLOATS];
    for r in 0..3 {
        let row = cofactor_direction(a, columns.map(|column| column[r]));
        let mut moved = 0.0;
        for c in 0..3 {
            // `+ 0.0` turns a rounded −0 into +0.
            let entry = (row[c] / det).round() + 0.0;
            m[r * 4 + c] = entry as f32;
            moved += entry * a0[c] as f64;
        }
        m[r * 4 + 3] = (b0[r] as f64 - moved) as f32;
    }
    m.iter().all(|v| v.is_finite()).then_some(m)
}

/// Whether `m` carries every triangle of `from` onto `to`, albedo equal, vertices bit for bit.
fn carries(flat: &[f32], albedo: &[u32], from: &[u32], to: &[u32], m: &[f32; 12]) -> bool {
    let vertex = |t: u32, v: usize| {
        let at = t as usize * PROXY_TRIANGLE_FLOATS + v * 3;
        [flat[at], flat[at + 1], flat[at + 2]]
    };
    from.iter().zip(to).all(|(&a, &b)| {
        albedo[a as usize] == albedo[b as usize]
            && (0..3).all(|v| {
                let placed = transform_point_3x4_f32(m, vertex(a, v));
                placed
                    .iter()
                    .zip(vertex(b, v))
                    .all(|(x, y)| x.is_finite() && x.to_bits() == y.to_bits())
            })
    })
}

/// A prototype run and the placements it carries, each with its map.
struct Group {
    prototype: usize,
    members: Vec<(usize, [f32; 12])>,
}

/// Shapes shared by placements. `owner[p]` names the placement of flat triangle `p`, `rank[p]`
/// its rank before the BVH reordered it: a run lists its triangles by that rank, which follows the
/// source triangle, so matching triangles of two copies meet at the same slot.
pub fn share(
    flat: &[f32],
    albedo: &[u32],
    owner: &[u32],
    rank: &[usize],
    bind_worlds: &[f64],
) -> Sharing {
    let worlds = bind_worlds.as_chunks::<16>().0;
    let mut by_rank = vec![0u32; rank.len()];
    for (position, &r) in rank.iter().enumerate() {
        by_rank[r] = position as u32;
    }
    let mut runs: Vec<Vec<u32>> = vec![Vec::new(); worlds.len()];
    for &position in &by_rank {
        runs[owner[position as usize] as usize].push(position);
    }
    let first = |run: &[u32]| {
        let at = run[0] as usize * PROXY_TRIANGLE_FLOATS;
        [flat[at], flat[at + 1], flat[at + 2]]
    };
    let mut groups: BTreeMap<usize, Vec<Group>> = BTreeMap::new();
    for (index, run) in runs.iter().enumerate().filter(|(_, run)| !run.is_empty()) {
        let (placement, start) = (&worlds[index], first(run));
        let candidates = groups.entry(run.len()).or_default();
        let joined = candidates.iter_mut().take(TRIES).any(|group| {
            let prototype = &runs[group.prototype];
            let found = map(
                &worlds[group.prototype],
                placement,
                &first(prototype),
                &start,
            )
            .filter(|m| carries(flat, albedo, prototype, run, m));
            found.map(|m| group.members.push((index, m))).is_some()
        });
        // A new prototype carries itself, unless a −0 the identity map would turn into +0.
        if !joined && carries(flat, albedo, run, run, &IDENTITY) {
            candidates.push(Group {
                prototype: index,
                members: vec![(index, IDENTITY)],
            });
        }
    }
    let mut sharing = Sharing::default();
    for (count, group) in groups
        .into_iter()
        .flat_map(|(key, list)| list.into_iter().map(move |g| (key, g)))
    {
        let members = group.members.len();
        let flat_words = members * count * TRIANGLE_WORDS;
        let shared_words = 1 + count * TRIANGLE_WORDS + members * (INSTANCE_WORDS + count);
        if shared_words >= flat_words {
            continue;
        }
        let shape = sharing.shapes.len() as u32;
        sharing.shapes.push(runs[group.prototype].clone());
        for (index, m) in group.members {
            sharing.instances.push((shape, m));
            sharing.positions.extend_from_slice(&runs[index]);
        }
    }
    sharing
}

#[cfg(test)]
#[path = "share_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "share_equivalence_tests.rs"]
mod equivalence_tests;
