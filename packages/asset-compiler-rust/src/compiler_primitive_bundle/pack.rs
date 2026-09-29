//! Which pages share a streaming bundle, and which bundles each one needs.
use super::*;

/// Packs ranks greedily into bundles of at most `STREAM_BUNDLE_BYTES`, a bundle never empty. Each
/// rank comes with the bundles holding its parents, ascending: a bundle is closed early rather than
/// need more than `bound` of them, and a rank that alone needs more is refused with its page named.
fn pack(
    ranks: &[(usize, Vec<usize>)],
    size: impl Fn(usize) -> usize,
    bound: usize,
    bundles: &mut Vec<Vec<usize>>,
) -> Result<()> {
    let mut current = Vec::new();
    let mut held = 0usize;
    let mut needed: Vec<usize> = Vec::new();
    for (rank, holders) in ranks {
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
        if !current.is_empty()
            && (held + bytes > STREAM_BUNDLE_BYTES || needed.len() + fresh > bound)
        {
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
        held += bytes;
    }
    if !current.is_empty() {
        bundles.push(current);
    }
    Ok(())
}

/// Bundles of culling ranks, the number of pinned ones, and the bundle of every DAG slot.
///
/// Roots come first and form their own bundles, level by level: the coarsest complete cover of the
/// primitive is a handful of pinned requests. The other levels follow from the coarsest to the
/// finest, a bundle holding one level only. Within a level, clusters are sorted by the first
/// bundle holding one of their parents, then by culling rank: siblings, which share parents, land
/// in the same bundle, and a bundle depends on as few others as the spatial order allows — never
/// more than `bound` directly, the bound [`dependency_bound`] fixes before packing.
pub(crate) fn pack_bundles(
    dag: &[DagCluster],
    groups: &[DagGroup],
    order: &[usize],
    bound: usize,
) -> Result<(Vec<Vec<usize>>, usize, Vec<usize>)> {
    let size = |rank: usize| dag[order[rank]].indices.len() * 4;
    let mut bundles: Vec<Vec<usize>> = Vec::new();
    let mut bundle_of = vec![usize::MAX; dag.len()];
    let top = dag.iter().map(|cluster| cluster.level).max().unwrap_or(0);
    let mut place = |root: bool, level: usize, bundles: &mut Vec<Vec<usize>>| -> Result<()> {
        let mut ranks: Vec<(usize, Vec<usize>)> = (0..order.len())
            .filter(|&rank| {
                let cluster = &dag[order[rank]];
                cluster.is_root() == root && cluster.level == level
            })
            .map(|rank| {
                let mut holders: Vec<usize> = parents_of(&dag[order[rank]], groups)
                    .iter()
                    .map(|&slot| bundle_of[slot])
                    .collect();
                holders.sort_unstable();
                holders.dedup();
                (rank, holders)
            })
            .collect();
        ranks
            .sort_by_key(|(rank, holders)| (holders.first().copied().unwrap_or(usize::MAX), *rank));
        let first = bundles.len();
        pack(&ranks, size, bound, bundles)?;
        for (index, bundle) in bundles.iter().enumerate().skip(first) {
            for &rank in bundle {
                bundle_of[order[rank]] = index;
            }
        }
        Ok(())
    };
    for level in 0..=top {
        place(true, level, &mut bundles)?;
    }
    let pinned = bundles.len();
    for level in (0..=top).rev() {
        place(false, level, &mut bundles)?;
    }
    Ok((bundles, pinned, bundle_of))
}
