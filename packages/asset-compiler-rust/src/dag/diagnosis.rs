//! Diagnosis of a stalled group: the counts that explain why its clusters stay roots.
//!
//! A group stalls when what the simplifier left does not fit its parents at any target cluster
//! size down to half a cluster (`solved.rs`): its cause is `unreducible`, its census the seam,
//! locked and island counts of its triangles.
use super::*;
use trillion3d_page_codec::encode::vertices::first_use;

/// Position counts of a group, over its live triangles.
struct Census {
    /// Positions used under several (position, texture coordinate) copies.
    seam: usize,
    /// Positions another group of the level also uses.
    locked: usize,
    /// Connected components of the triangles over (position, texture coordinate)-welded corners.
    islands: usize,
}

/// Counts the group's positions and texture islands. `weld_seam` is `weld` when the primitive
/// carries no texture set: no position is then a seam corner, and islands are position-connected.
fn census(input: &GroupReductionInput, live: &[u32]) -> Census {
    // Per position: the first (position, texture coordinate) copy seen, seam, locked.
    let mut positions: WordMap<u32, (u32, bool, bool)> = WordMap::default();
    for &vertex in live {
        let copy = input.weld_seam[vertex as usize];
        let locked = input.locks[vertex as usize];
        let entry = positions
            .entry(input.weld[vertex as usize])
            .or_insert((copy, false, locked));
        entry.1 |= entry.0 != copy;
    }
    let islands = islands(live, input.weld_seam);
    let seam = positions.values().filter(|p| p.1).count();
    let locked = positions.values().filter(|p| p.2).count();
    Census {
        seam,
        locked,
        islands,
    }
}

/// Connected components of `live` over its corners welded by `weld`.
fn islands(live: &[u32], weld: &[u32]) -> usize {
    let (local, corners) = first_use(live.iter().map(|&v| weld[v as usize]));
    let mut join = crate::join::Join::new(local.len());
    for tri in corners.as_chunks::<3>().0 {
        join.unite(tri[0], tri[1]);
        join.unite(tri[0], tri[2]);
    }
    (0..local.len() as u32)
        .filter(|&k| join.root(k) == k)
        .count()
}

/// The stalled group's outcome under a cause already known: its live triangles and census.
pub(super) fn outcome(
    cause: StallCause,
    input: &GroupReductionInput,
    live: &[u32],
) -> GroupOutcome {
    let census = census(input, live);
    GroupOutcome {
        cause,
        triangles: live.len() / 3,
        seam: census.seam,
        locked: census.locked,
        islands: census.islands,
    }
}
