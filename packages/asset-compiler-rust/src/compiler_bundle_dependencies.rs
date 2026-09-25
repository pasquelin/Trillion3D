//! Page dependencies of the streaming bundles.
//!
//! A cluster is only drawn instead of its parents, the outputs of the group that replaces it. A
//! bundle therefore depends on the bundles holding those parents, and the list it carries is closed
//! transitively up to the pinned root cover: the runtime installs a bundle after every bundle on the
//! list, so the nearest resident ancestor of a cluster is at most one level above it.
use super::*;
use crate::dag::{DagCluster, DagGroup};

fn refuse(message: String) -> CompilerError {
    CompilerError::new("INVALID_PAGE_DEPENDENCIES", message)
}

/// The clusters that replace `cluster`: the outputs of its group, none for a root.
pub(super) fn parents_of<'a>(cluster: &DagCluster, groups: &'a [DagGroup]) -> &'a [usize] {
    cluster
        .group
        .and_then(|group| groups.get(group))
        .map_or(&[], |group| &group.outputs[..])
}

/// The most bundles a bundle may need for the parents of its clusters, fixed before packing: the
/// most parents one cluster has. A cluster's parents sit in at most that many bundles, so a bundle
/// never needs more than its neediest cluster alone; packing closes a bundle before it would.
pub(super) fn dependency_bound(dag: &[DagCluster], groups: &[DagGroup]) -> usize {
    dag.iter()
        .map(|cluster| parents_of(cluster, groups).len())
        .max()
        .unwrap_or(0)
}

/// For each bundle, the other bundles holding a parent of one of its clusters, ascending.
pub(super) fn direct_dependencies(
    dag: &[DagCluster],
    groups: &[DagGroup],
    bundle_of: &[usize],
    bundles: usize,
) -> Vec<Vec<usize>> {
    let mut direct: Vec<Vec<usize>> = vec![Vec::new(); bundles];
    for (slot, cluster) in dag.iter().enumerate() {
        let own = bundle_of[slot];
        for &parent in parents_of(cluster, groups) {
            if bundle_of[parent] != own {
                direct[own].push(bundle_of[parent]);
            }
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
pub(super) fn close_dependencies(direct: &[Vec<usize>]) -> Result<Vec<Vec<usize>>> {
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

/// Refuses dependency lists the runtime could not install in order, naming the page or bundle: a
/// page whose parents' bundle is not listed, a pinned bundle that depends on anything, a bundle
/// whose closure misses the root cover, or a list that is not closed.
pub(super) fn verify_dependencies(
    dag: &[DagCluster],
    groups: &[DagGroup],
    order: &[usize],
    bundle_of: &[usize],
    closed: &[Vec<usize>],
    pinned: usize,
) -> Result<()> {
    for (page, &slot) in order.iter().enumerate() {
        let own = bundle_of[slot];
        for &parent in parents_of(&dag[slot], groups) {
            let holder = bundle_of[parent];
            if holder != own && closed[own].binary_search(&holder).is_err() {
                return Err(refuse(format!(
                    "Page {page} sits in streaming bundle {own}, which does not list bundle {holder} holding its parents"
                )));
            }
        }
    }
    for (bundle, list) in closed.iter().enumerate() {
        if bundle < pinned && !list.is_empty() {
            return Err(refuse(format!(
                "Pinned streaming bundle {bundle} depends on other bundles"
            )));
        }
        if bundle >= pinned && !list.iter().any(|&dependency| dependency < pinned) {
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
