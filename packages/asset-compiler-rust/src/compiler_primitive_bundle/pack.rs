//! Which pages share a streaming bundle, and which bundles each one needs.
use super::*;

/// One rank to pack: its culling rank, the bundles holding its parents, ascending, and its run.
type Entry = (usize, Vec<usize>, usize);

/// Packs entries greedily into bundles of at most `STREAM_BUNDLE_BYTES`, a bundle never empty and
/// never two runs. Each entry comes with the bundles holding its parents: a bundle is closed early
/// rather than need more than `bound` of them, and a rank that alone needs more is refused with its
/// page named.
fn pack(
    entries: &[Entry],
    size: impl Fn(usize) -> usize,
    bound: usize,
    bundles: &mut Vec<Vec<usize>>,
) -> Result<()> {
    let mut current = Vec::new();
    let (mut held, mut run) = (0usize, 0usize);
    let mut needed: Vec<usize> = Vec::new();
    for (rank, holders, own) in entries {
        if holders.len() > bound {
            return Err(CompilerError::new(
                "PAGE_DEPENDENCY_BOUND",
                format!(
                    "Page {rank} has its parents in {} streaming bundles, over the bound of {bound}",
                    holders.len()
                ),
            ));
        }
        let bytes = size(*rank);
        let fresh = holders
            .iter()
            .filter(|holder| needed.binary_search(holder).is_err())
            .count();
        let full = held + bytes > STREAM_BUNDLE_BYTES || needed.len() + fresh > bound;
        if !current.is_empty() && (full || *own != run) {
            bundles.push(std::mem::take(&mut current));
            held = 0;
            needed.clear();
        }
        for &holder in holders {
            if let Err(at) = needed.binary_search(&holder) {
                needed.insert(at, holder);
            }
        }
        current.push(*rank);
        (held, run) = (held + bytes, *own);
    }
    if !current.is_empty() {
        bundles.push(current);
    }
    Ok(())
}

/// What a DAG slot weighs in its bundle, and the cell holding it when it is a root packed past the
/// pinned top — in the world DAG, a root one cell alone needs (`compiler_world_roots/top.rs`) —:
/// `None` for a pinned root or any other cluster.
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
/// `bytes` is what the cluster at a DAG slot weighs in its bundle: its indices for a primitive
/// ([`index_bytes`]), its written page for a world super-root; `held` names the cell of a root it
/// packs past the pinned top ([`pack_primitive`] pins every root).
pub(crate) fn pack_bundles(
    dag: &[DagCluster],
    groups: &[DagGroup],
    order: &[usize],
    bound: usize,
    (bytes, held): Packing,
) -> Result<(Vec<Vec<usize>>, usize, Vec<usize>)> {
    let size = |rank: usize| bytes(order[rank]);
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
                (rank, holders, held(slot).unwrap_or(0))
            })
            .collect();
        entries.sort_by_key(|(rank, holders, run)| {
            (holders.first().copied().unwrap_or(usize::MAX), *run, *rank)
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

/// The bundles of a primitive's DAG ([`pack_bundles`]): its clusters weigh their indices, and its
/// whole root cover is pinned.
pub(crate) fn pack_primitive(
    dag: &[DagCluster],
    groups: &[DagGroup],
    order: &[usize],
    bound: usize,
) -> Result<(Vec<Vec<usize>>, usize, Vec<usize>)> {
    pack_bundles(dag, groups, order, bound, (&index_bytes(dag), &|_| None))
}

/// What a primitive's cluster at each slot of `dag` weighs in its bundle: its indices, four bytes
/// each.
pub(crate) fn index_bytes(dag: &[DagCluster]) -> impl Fn(usize) -> usize + '_ {
    |slot| dag[slot].indices.len() * 4
}
