//! The parts a reduction removes whole, and how far the surface it keeps lies from them.
//!
//! A reduction's error measures how far what it keeps moves from the surface it replaces; it says
//! nothing of a disconnected part it removes whole, which only answers for its own size. A roof of
//! shingles 0.4 m across, each removed at 0.4 m of error, loses half its shingles on one level and
//! half the rest on the next, all at the same 0.4 m: its coarsest level kept 1.8 % of its area on
//! the open world's chalet (#484). A part removed whole therefore costs the distance from its
//! surface to the nearest surface the reduction keeps — a part under the error is pruned, a roof
//! of parts keeps a cover within its error.
use crate::join::Join;
use crate::physics_cook::hausdorff::one_sided_distance;
use std::collections::HashMap;

/// Largest distance from the parts of `source` of which `kept` holds no vertex to the triangles of
/// `kept`, both over the source vertices; parts meet at a shared position (`weld`).
pub(super) fn vanished_distance(
    source: &[u32],
    kept: &[u32],
    positions: &[f32],
    weld: &[u32],
) -> f64 {
    let mut local: HashMap<u32, u32> = HashMap::new();
    let mut id = |v: u32| {
        let next = local.len() as u32;
        *local.entry(weld[v as usize]).or_insert(next)
    };
    let corners: Vec<u32> = source.iter().map(|&v| id(v)).collect();
    let mut join = Join::new(local.len());
    for tri in corners.as_chunks::<3>().0 {
        join.unite(tri[0], tri[1]);
        join.unite(tri[0], tri[2]);
    }
    let mut alive = vec![false; local.len()];
    for v in kept {
        if let Some(&l) = local.get(&weld[*v as usize]) {
            alive[join.root(l) as usize] = true;
        }
    }
    let vanished: Vec<u32> = source
        .as_chunks::<3>()
        .0
        .iter()
        .zip(corners.as_chunks::<3>().0)
        .filter(|(_, local)| !alive[join.root(local[0]) as usize])
        .flat_map(|(tri, _)| *tri)
        .collect();
    one_sided_distance(positions, &vanished, kept)
}
