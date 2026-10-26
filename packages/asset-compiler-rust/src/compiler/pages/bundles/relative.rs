//! Which streaming pages name vertices of the pages they depend on.
//!
//! A page that names a vertex of a cluster of another streaming page can be installed only once
//! that cluster is, and its own vertices only after the vertices it names there (`refs.rs` of the
//! page codec). A chain of pages each naming the one before would be installed one at a time, so
//! the chain is cut: counted from the pages that nothing depends on, a page with `MAX_RELATIVE_CHAIN`
//! levels of dependents below it stores its vertices instead, and the count starts again above it.
//! A root page — always resident, the root of its chains — names nothing of another page; a page
//! whose dependencies are root pages alone always does.
use trillion3d_page_codec::refs::MAX_RELATIVE_CHAIN;

/// For each streaming page, whether it names vertices of the pages it depends on. `direct[p]` is
/// the pages `p` is installed after directly, `root[p]` whether `p` is a root page.
pub(super) fn relative_pages(root: &[bool], direct: &[Vec<usize>]) -> Vec<bool> {
    let count = direct.len();
    let mut dependents: Vec<Vec<usize>> = vec![Vec::new(); count];
    let mut only_roots = vec![false; count];
    for (page, list) in direct.iter().enumerate() {
        let (mut roots, mut streamed) = (false, false);
        for &dependency in list {
            if root[dependency] {
                roots = true;
            } else {
                if dependents[dependency].last() != Some(&page) {
                    dependents[dependency].push(page);
                }
                streamed = true;
            }
        }
        only_roots[page] = roots && !streamed;
    }
    let mut depth = vec![u32::MAX; count];
    let mut relative = vec![false; count];
    for page in 0..count {
        chain_depth(page, &dependents, &mut depth, &mut relative);
        if root[page] {
            relative[page] = false;
        } else if only_roots[page] {
            relative[page] = true;
        }
    }
    relative
}

/// The levels of dependents below `page`, the greatest of its dependents' plus one, memoized; the
/// page is marked relative unless that count reaches `MAX_RELATIVE_CHAIN`, which stores it and
/// starts the count again.
fn chain_depth(
    page: usize,
    dependents: &[Vec<usize>],
    depth: &mut [u32],
    relative: &mut [bool],
) -> u32 {
    if depth[page] != u32::MAX {
        return depth[page];
    }
    let mut levels = 0;
    for &dependent in &dependents[page] {
        levels = levels.max(chain_depth(dependent, dependents, depth, relative) + 1);
    }
    relative[page] = true;
    if levels >= MAX_RELATIVE_CHAIN {
        relative[page] = false;
        levels = 0;
    }
    depth[page] = levels;
    levels
}

#[cfg(test)]
mod tests {
    use super::relative_pages;
    use trillion3d_page_codec::refs::MAX_RELATIVE_CHAIN;

    /// A root page and a chain of pages each depending on the one before: the chain is cut every
    /// `MAX_RELATIVE_CHAIN` pages from its finest end, the page after the root names the root's.
    #[test]
    fn a_chain_of_pages_is_cut_every_so_many_levels() {
        let length = 2 * MAX_RELATIVE_CHAIN as usize + 3;
        let root: Vec<bool> = (0..length).map(|page| page == 0).collect();
        let direct: Vec<Vec<usize>> = (0..length)
            .map(|page| if page == 0 { vec![] } else { vec![page - 1] })
            .collect();
        let relative = relative_pages(&root, &direct);
        assert!(!relative[0], "a root page stores its vertices");
        assert!(relative[1], "a page that depends on roots alone names them");
        assert!(relative[length - 1], "the finest page names its parent's");
        assert!(
            relative.iter().filter(|&&named| !named).count() >= 2,
            "the chain is cut: {relative:?}"
        );
    }
}
