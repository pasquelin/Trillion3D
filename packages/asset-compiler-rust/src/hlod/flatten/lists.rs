//! The list helpers the charts and the simplifier share.

/// `item` appended to `list` unless already there.
pub(crate) fn push_unique(list: &mut Vec<u32>, item: u32) {
    if !list.contains(&item) {
        list.push(item);
    }
}
