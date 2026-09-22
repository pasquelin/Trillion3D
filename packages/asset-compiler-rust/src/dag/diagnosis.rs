//! Diagnosis of a stalled group: why its clusters stay roots, decided by experiment on the group
//! itself, with no threshold.
//!
//! Two things hold a position still: a position another group of the level also uses is locked so
//! the cut stays watertight, and a position the group writes under several texture coordinates is
//! a seam corner the fallback weld keeps apart, so a coarse level never draws one side of a seam
//! with the other's texture. The reduction that stalled is rerun with each constraint lifted in
//! turn: with no lock, if it then advances the border shared with the neighbours held the group
//! (`border-locked`); with no lock and every position copy welded across the seams of every
//! texture set, if it then advances the seams held it (`seam-locked`); if neither advances, the
//! surface itself resists the halving (`unreducible`). The reruns only diagnose: their result is
//! dropped, the group stays stalled and the DAG is the one built without them.
use super::border::live_triangles;
use super::reduce::{attempt, Stop};
use super::*;

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
    let mut positions: HashMap<u32, (u32, bool, bool)> = HashMap::new();
    // Per (position, texture coordinate) copy: its slot in the union-find.
    let mut slots: HashMap<u32, u32> = HashMap::new();
    for &vertex in live {
        let copy = input.weld_seam[vertex as usize];
        let locked = input.locks[vertex as usize];
        let entry = positions
            .entry(input.weld[vertex as usize])
            .or_insert((copy, false, locked));
        entry.1 |= entry.0 != copy;
        let next = slots.len() as u32;
        slots.entry(copy).or_insert(next);
    }
    let mut parent: Vec<u32> = (0..slots.len() as u32).collect();
    for tri in live.as_chunks::<3>().0 {
        let a = slots[&input.weld_seam[tri[0] as usize]];
        for &corner in &tri[1..] {
            let b = slots[&input.weld_seam[corner as usize]];
            let (ra, rb) = (find(&mut parent, a), find(&mut parent, b));
            parent[ra as usize] = rb;
        }
    }
    let islands = (0..parent.len() as u32)
        .filter(|&slot| find(&mut parent, slot) == slot)
        .count();
    let seam = positions.values().filter(|p| p.1).count();
    let locked = positions.values().filter(|p| p.2).count();
    Census {
        seam,
        locked,
        islands,
    }
}

fn find(parent: &mut [u32], mut slot: u32) -> u32 {
    while parent[slot as usize] != slot {
        let up = parent[parent[slot as usize] as usize];
        parent[slot as usize] = up;
        slot = up;
    }
    slot
}

/// Names why the group stalled. `last` holds the indices of the attempt that stalled, rerun
/// without locks, then without locks on positions welded across seams.
pub(super) fn stalled(
    input: &GroupReductionInput,
    live: &[u32],
    last: &[u32],
    children: usize,
    stop: Stop,
) -> Result<GroupOutcome> {
    let advances = |indices: &[u32]| -> Result<bool> {
        Ok(matches!(attempt(input, indices, false)?, Ok(a) if a.progresses(children)))
    };
    let cause = match stop {
        Stop::TooSmall => StallCause::TooSmall,
        Stop::BorderLost => StallCause::BorderLost,
        Stop::UnusableError => StallCause::UnusableError,
        Stop::NoCollapse if advances(last)? => StallCause::BorderLocked,
        Stop::NoCollapse => {
            let welded = live_triangles(live.iter().map(|&i| input.weld[i as usize]));
            // Without a texture set, or without a seam, the weld changes nothing: same rerun.
            if welded != last && advances(&welded)? {
                StallCause::SeamLocked
            } else {
                StallCause::Unreducible
            }
        }
    };
    let census = census(input, live);
    Ok(GroupOutcome {
        cause,
        triangles: live.len() / 3,
        seam: census.seam,
        locked: census.locked,
        islands: census.islands,
    })
}
