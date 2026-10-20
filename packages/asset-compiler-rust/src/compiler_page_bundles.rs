//! Which pages share a streaming bundle — the unit a runtime reads, keeps and drops —, which
//! bundles each one needs, and the bundles laid end to end: a primitive's geometry pages
//! (`compiler_primitive_pages.rs`) and the world DAG's (`compiler_world_roots/pack.rs`), one packer
//! and one layout (`lay_bundles`).
//!
//! A bundle never splits the clusters one group replaces: they swap for its outputs together
//! (`sdk-browser/src/geometry/cut/readiness.ts`), so a bundle that holds one holds all, and a group's
//! finer surface lands in one read or not at all.
use super::*;
use crate::dag::{DagCluster, DagGroup};

mod lay;
mod packer;
pub(crate) use lay::{lay_bundles, Bundle};
use packer::{pack, Entry};

/// What a culling rank weighs in its bundle, and the cell holding it when it is a root packed past
/// the pinned top — in the world DAG, a root one cell alone needs (`compiler_world_roots/pack.rs`)
/// —, by DAG slot: `None` for a pinned root or any other cluster.
pub(crate) type Packing<'a> = (
    &'a dyn Fn(usize) -> usize,
    &'a dyn Fn(usize) -> Option<usize>,
);

/// Bundles of culling ranks, the number of pinned ones, and the bundle of every DAG slot.
///
/// Every rank is filed once. Pinned roots come first and form their own bundles, level by level:
/// the coarsest complete cover of the primitive is a handful of pinned requests. The roots a cell
/// holds follow, every level together, sorted by cell then culling rank, a bundle never holding
/// two cells: a held cell asks for its own roots in as few bundles as their bytes allow, and pays
/// them alone. The other levels follow from the coarsest to the finest, a bundle holding one level
/// only. Within a level, clusters are sorted by the first bundle holding one of their parents,
/// then by culling rank: siblings, which share parents, land in the same bundle, and a bundle
/// depends on as few others as the spatial order allows — never more than `bound` directly, the
/// bound [`dependency_bound`] fixes before packing.
///
/// `size` is what the page at a culling rank weighs in its bundle (`lay_bundles`: its bytes, or
/// its indices for a rank without a page); `held` names, by DAG slot, the cell of a root it packs
/// past the pinned top.
pub(crate) fn pack_bundles(
    dag: &[DagCluster],
    groups: &[DagGroup],
    order: &[usize],
    bound: usize,
    (size, held): Packing,
) -> Result<(Vec<Vec<usize>>, usize, Vec<usize>)> {
    let top = dag.iter().map(|cluster| cluster.level).max().unwrap_or(0);
    // Per level, its pinned roots and its other clusters; the held roots apart, every level.
    let (mut pinned_at, mut other_at) = (vec![Vec::new(); top + 1], vec![Vec::new(); top + 1]);
    let mut held_roots = Vec::new();
    for (rank, &slot) in order.iter().enumerate() {
        let cluster = &dag[slot];
        match (cluster.is_root(), held(slot)) {
            (true, None) => pinned_at[cluster.level].push(rank),
            (true, Some(_)) => held_roots.push(rank),
            (false, _) => other_at[cluster.level].push(rank),
        }
    }
    let mut bundles: Vec<Vec<usize>> = Vec::new();
    let mut bundle_of = vec![usize::MAX; dag.len()];
    let mut place = |ranks: &[usize], bundles: &mut Vec<Vec<usize>>| -> Result<()> {
        let mut entries: Vec<Entry> = (ranks.iter())
            .map(|&rank| {
                let slot = order[rank];
                let mut holders: Vec<usize> = (parents_of(&dag[slot], groups).iter())
                    .map(|&parent| bundle_of[parent])
                    .collect();
                holders.sort_unstable();
                holders.dedup();
                (rank, holders, held(slot).unwrap_or(0), dag[slot].group)
            })
            .collect();
        entries.sort_by_key(|(rank, holders, run, group)| {
            (
                holders.first().copied().unwrap_or(usize::MAX),
                *run,
                *group,
                *rank,
            )
        });
        let first = bundles.len();
        pack(&entries, size, bound, bundles)?;
        for (index, bundle) in bundles.iter().enumerate().skip(first) {
            for &rank in bundle {
                bundle_of[order[rank]] = index;
            }
        }
        Ok(())
    };
    for ranks in &pinned_at {
        place(ranks, &mut bundles)?;
    }
    let pinned = bundles.len();
    // A root has no parent: the held ones, cell by cell, need no bundle placed before them.
    place(&held_roots, &mut bundles)?;
    for ranks in other_at.iter().rev() {
        place(ranks, &mut bundles)?;
    }
    Ok((bundles, pinned, bundle_of))
}
