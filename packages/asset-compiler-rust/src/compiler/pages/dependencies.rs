//! Page dependencies of the streaming pages.
//!
//! A cluster is only drawn instead of its parents, the outputs of the group that replaces it. Every
//! page holding a cluster of a group therefore depends on every page of each group holding one of
//! its outputs — of a cover's roots for an output nothing replaces —, and the list it carries is
//! closed transitively up to a root page (`bundles.rs`): the pinned cover's, or in the world DAG one
//! an HLOD cell holds while its actor is loaded (`../../hlod/chain/bundles.rs`). The walk lays
//! every group after the groups holding its outputs, so a page depends on earlier pages only, and a
//! root page on root pages alone: the runtime installs a page after every page on its list, so the
//! nearest resident ancestor of a cluster is at most one level above it.
use crate::dag::{DagCluster, DagGroup};
use crate::*;

fn refuse(message: String) -> CompilerError {
    CompilerError::new("INVALID_PAGE_DEPENDENCIES", message)
}

/// The clusters that replace `cluster`: the outputs of its group, none for a root.
pub(crate) fn parents_of<'a>(cluster: &DagCluster, groups: &'a [DagGroup]) -> &'a [usize] {
    cluster
        .group
        .and_then(|group| groups.get(group))
        .map_or(&[], |group| &group.outputs[..])
}

/// The pages `members` lie in (`page_of`), ascending, each once.
fn pages_of(members: impl Iterator<Item = usize>, page_of: &[usize]) -> Vec<usize> {
    let mut pages: Vec<usize> = members.map(|slot| page_of[slot]).collect();
    pages.sort_unstable();
    pages.dedup();
    pages
}

/// For each of the `count` pages, the other pages it is installed after, ascending: every page of
/// each group holding an output of a group with a cluster in it, the pages of its cover's roots —
/// the clusters `held` files in one cover that no group holds — for an output nothing replaces.
pub(crate) fn direct_dependencies(
    dag: &[DagCluster],
    groups: &[DagGroup],
    (page_of, count): (&[usize], usize),
    held: &dyn Fn(usize) -> Option<usize>,
) -> Vec<Vec<usize>> {
    let group_pages: Vec<Vec<usize>> = (groups.iter())
        .map(|group| pages_of(group.children.iter().copied(), page_of))
        .collect();
    let mut root_pages: BTreeMap<Option<usize>, Vec<usize>> = BTreeMap::new();
    for slot in (0..dag.len()).filter(|&slot| dag[slot].group.is_none()) {
        root_pages
            .entry(held(slot))
            .or_default()
            .push(page_of[slot]);
    }
    root_pages.values_mut().for_each(|pages| {
        pages.sort_unstable();
        pages.dedup();
    });
    let mut direct: Vec<Vec<usize>> = vec![Vec::new(); count];
    for (group, own) in groups.iter().zip(&group_pages) {
        let mut parents: Vec<usize> = Vec::new();
        for &output in &group.outputs {
            let holders = match dag[output].group {
                Some(parent) => &group_pages[parent],
                None => &root_pages[&held(output)],
            };
            parents.extend_from_slice(holders);
        }
        for &page in own {
            direct[page].extend(parents.iter().filter(|&&parent| parent != page));
        }
    }
    for list in &mut direct {
        list.sort_unstable();
        list.dedup();
    }
    direct
}

/// Closes every list transitively. A cycle is refused with the bundle it passes through: no
/// install order exists for it.
pub(crate) fn close_dependencies(direct: &[Vec<usize>]) -> Result<Vec<Vec<usize>>> {
    const OPEN: u8 = 1;
    const DONE: u8 = 2;
    fn visit(
        bundle: usize,
        direct: &[Vec<usize>],
        state: &mut [u8],
        closed: &mut [Vec<usize>],
    ) -> Result<()> {
        match state[bundle] {
            DONE => return Ok(()),
            OPEN => {
                return Err(refuse(format!(
                    "Streaming bundle {bundle} depends on itself through a cycle"
                )))
            }
            _ => {}
        }
        state[bundle] = OPEN;
        let mut list = Vec::new();
        for &dependency in &direct[bundle] {
            if dependency >= direct.len() {
                return Err(refuse(format!(
                    "Streaming bundle {bundle} depends on bundle {dependency}, which does not exist"
                )));
            }
            visit(dependency, direct, state, closed)?;
            list.push(dependency);
            list.extend_from_slice(&closed[dependency]);
        }
        list.sort_unstable();
        list.dedup();
        closed[bundle] = list;
        state[bundle] = DONE;
        Ok(())
    }
    let mut state = vec![0u8; direct.len()];
    let mut closed = vec![Vec::new(); direct.len()];
    for bundle in 0..direct.len() {
        visit(bundle, direct, &mut state, &mut closed)?;
    }
    Ok(closed)
}

/// Refuses dependency lists the runtime could not install in order, naming the page: a cluster
/// page whose parents' streaming page is not listed, a root page — `root`, by streaming page — that
/// depends on another page than a root page, another page whose closure misses every root page, or
/// a list that is not closed. Every list then ends at a root page, the top of its own chain — but
/// for a page none of whose clusters has a parent: the children of a group that stalled
/// (`DagStall`) have nothing above them to wait for.
pub(crate) fn verify_dependencies(
    dag: &[DagCluster],
    groups: &[DagGroup],
    (page_of, root): (&[usize], &[bool]),
    closed: &[Vec<usize>],
) -> Result<()> {
    let mut parented = vec![false; closed.len()];
    for (slot, cluster) in dag.iter().enumerate() {
        let own = page_of[slot];
        parented[own] |= !parents_of(cluster, groups).is_empty();
        for &parent in parents_of(cluster, groups) {
            let holder = page_of[parent];
            if holder != own && closed[own].binary_search(&holder).is_err() {
                return Err(refuse(format!(
                    "Cluster {slot} sits in streaming bundle {own}, which does not list bundle {holder} holding its parents"
                )));
            }
        }
    }
    for (bundle, list) in closed.iter().enumerate() {
        if root[bundle] && list.iter().any(|&dependency| !root[dependency]) {
            return Err(refuse(format!(
                "Root page streaming bundle {bundle} depends on a streaming page"
            )));
        }
        if !root[bundle] && parented[bundle] && !list.iter().any(|&dependency| root[dependency]) {
            return Err(refuse(format!(
                "Streaming bundle {bundle} does not reach the root cover"
            )));
        }
        for &dependency in list {
            if closed[dependency]
                .iter()
                .any(|further| list.binary_search(further).is_err())
            {
                return Err(refuse(format!(
                    "Streaming bundle {bundle} does not list the dependencies of bundle {dependency}"
                )));
            }
        }
    }
    Ok(())
}
