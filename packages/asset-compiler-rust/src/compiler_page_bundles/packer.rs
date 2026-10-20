//! The greedy packer of culling ranks into streaming bundles, one run and one budget at a time.
use super::*;

/// One rank to pack: its culling rank, the bundles holding its parents, ascending, its run, and the
/// group that replaces it (`None` for a root).
pub(super) type Entry = (usize, Vec<usize>, usize, Option<usize>);

/// Packs entries greedily into bundles of about `STREAM_BUNDLE_BYTES`, a bundle never empty, never
/// two runs, and never cutting the members of one group: a group past the budget closes the bundle
/// before it, and only a group larger than the budget overflows one. Each entry comes with the
/// bundles holding its parents — one group's members share them —: a bundle is closed early rather
/// than need more than `bound` of them, and a rank that alone needs more is refused with its page
/// named.
pub(super) fn pack(
    entries: &[Entry],
    size: impl Fn(usize) -> usize,
    bound: usize,
    bundles: &mut Vec<Vec<usize>>,
) -> Result<()> {
    let mut current = Vec::new();
    let (mut held, mut run) = (0usize, 0usize);
    let mut needed: Vec<usize> = Vec::new();
    // The group of the bundle's last rank, and where in the bundle that group started.
    let (mut group, mut started) = (None::<usize>, 0usize);
    for (rank, holders, own, replaced_by) in entries {
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
        let continues = replaced_by.is_some() && *replaced_by == group && *own == run;
        if full && continues && started > 0 {
            // The group would cross the budget: it moves whole to a new bundle.
            let moved = current.split_off(started);
            bundles.push(std::mem::replace(&mut current, moved));
            held = current.iter().map(|&r| size(r)).sum();
            started = 0;
            // One group's members share their parents: this rank's holders are the moved ones'.
            needed.clear();
        } else if !current.is_empty() && !continues && (full || *own != run) {
            // A new run, or a full bundle the rank's group does not continue, closes it.
            bundles.push(std::mem::take(&mut current));
            (held, started) = (0, 0);
            needed.clear();
        }
        if !continues {
            (group, started) = (*replaced_by, current.len());
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
