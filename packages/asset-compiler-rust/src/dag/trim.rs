//! The finest detail of a built DAG cut away (`cut_finest`): the coarsest cut that holds more than
//! a share of the source's triangles, or whose error falls under a share of the mesh's size,
//! becomes the finest level the pages carry, every cluster under it dropped.
//!
//! The cut is grown from the roots: the cluster of largest error is replaced by the children of
//! the group that made it, again and again, until the cut holds more triangles than the share
//! asks or its error falls under the bound, and the next cluster would lower it further; it stops
//! too where the cluster of largest error is a source cluster. Each cluster left in the cut is a
//! leaf: it was made by no group the pages keep, so its error is zero — a runtime draws it
//! wherever its parent is too coarse, as it draws a source cluster. The grid the pages share is
//! still set by the clusters the build made, those the cut drops included: `cut_finest` measures
//! their boxes before it cuts and returns them (`geometry_page::quant::page_extents`).
//!
//! The cut itself (`find_cut`) is found once for every use: a merged layer's fallback of a source
//! starts from one too (`hlod::flatten::merge::fallback`).
use super::*;
use crate::geometry_page::quant::page_extents;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use trillion3d_page_codec::bits::grid::Extent;
use trillion3d_page_codec::clusters::named_bounds;

/// What a build keeps of its finest detail once every level is built: `kept_triangles`, the share
/// of the source's triangles the cut may hold, in [0, 1]; `trimmed_error`, the error the cut must
/// reach, in percent of the mesh's size — the square root of the smaller of twice its area and a
/// quarter of its box's surface. A share of 1 and an error of 0, the defaults, cut nothing.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Trim {
    pub kept_triangles: f32,
    pub trimmed_error: f32,
}
impl Default for Trim {
    fn default() -> Self {
        Self {
            kept_triangles: crate::DEFAULT_KEPT_TRIANGLES as f32,
            trimmed_error: crate::DEFAULT_TRIMMED_ERROR as f32,
        }
    }
}
impl Trim {
    /// Whether the trim cuts anything: a share under 1 or an error above 0.
    pub fn cuts(&self) -> bool {
        self.kept_triangles < 1.0 || self.trimmed_error > 0.0
    }
}

/// The size of a mesh of surface `area` in the box `low`, `high`, which an error is a share of:
/// the square root of the smaller of twice the area and half the sum of the products of the box's
/// sides — a quarter of the box's surface.
pub(crate) fn relative_size(area: f32, (low, high): ([f32; 3], [f32; 3])) -> f32 {
    let [x, y, z] = [0, 1, 2].map(|axis| high[axis] - low[axis]);
    let box_area = 0.5 * (x * y + x * z + y * z);
    (2.0 * area).min(box_area).sqrt()
}

/// The size (`relative_size`) the trim's error is a share of: the area of the `source` triangles
/// over `positions` (`simplify::region::surface_area`), the box of the vertices they name
/// (`named_bounds`).
fn mesh_size(positions: &[f32], source: &[u32]) -> f32 {
    let area = crate::simplify::region::surface_area(positions, source);
    relative_size(area, named_bounds(positions, source))
}

/// The rank among the kept items of each item `keep` keeps, in order; none for one it drops.
fn renumbered(keep: &[bool]) -> Vec<Option<usize>> {
    let mut next = 0;
    (keep.iter())
        .map(|&k| {
            let at = k.then_some(next);
            next += usize::from(k);
            at
        })
        .collect()
}

/// The items of `items` that `keep` keeps, in order.
fn kept_of<T>(items: Vec<T>, keep: &[bool]) -> Vec<T> {
    (items.into_iter().zip(keep))
        .filter_map(|(item, &k)| k.then_some(item))
        .collect()
}

/// A cut found in a DAG (`find_cut`).
pub(crate) struct Found {
    /// Per cluster: it stood in the cut at some point, from the roots down.
    pub kept: Vec<bool>,
    /// Per group: the cut replaced a cluster it made by the group's children.
    pub opened: Vec<bool>,
    /// The clusters the cut ends with, in slot order.
    pub cut: Vec<usize>,
}

/// The coarsest cut of `dag`, whose `groups` made its clusters, that holds more than
/// `most_triangles` triangles or whose error falls under `least_error`, grown from the roots: the
/// cluster of largest error — among equals, the earliest — is replaced by the children of the group
/// that made it until the target is reached and the next cluster would lower the error further;
/// it stops too where that cluster is a source cluster, or one the trim left as a leaf.
///
/// With an `overshoot` above 0, the first time the target is reached the triangles it asks move up
/// to the cut's own plus `overshoot`, and the cut goes on: it ends finer than the target asks, by
/// the triangles of the clusters it takes to do so.
pub(crate) fn find_cut(
    dag: &[DagCluster],
    groups: &[DagGroup],
    (mut most_triangles, least_error): (usize, f64),
    overshoot: usize,
) -> Found {
    // Largest error first; among equal errors, the earliest cluster.
    let entry = |slot: usize| (dag[slot].lod_error.to_bits(), Reverse(slot));
    let mut cut = BinaryHeap::new();
    let (mut triangles, mut cut_error) = (0, 0.0);
    for (slot, cluster) in dag.iter().enumerate().filter(|(_, c)| c.group.is_none()) {
        cut.push(entry(slot));
        triangles += cluster.triangles();
        cut_error = cluster.lod_error;
    }
    let mut kept = vec![false; dag.len()];
    cut.iter().for_each(|&(_, Reverse(slot))| kept[slot] = true);
    let mut opened = vec![false; groups.len()];
    let mut overshot = false;
    while let Some(&(_, Reverse(slot))) = cut.peek() {
        let cluster = &dag[slot];
        let Some(made_by) = cluster.source.filter(|_| cluster.level > 0) else {
            break;
        };
        let mut reached = triangles > most_triangles || cut_error < least_error;
        if overshoot > 0 && reached && !overshot {
            most_triangles = triangles + overshoot;
            (reached, overshot) = (false, true);
        }
        if reached && cluster.lod_error < cut_error {
            break;
        }
        cut.pop();
        triangles -= cluster.triangles();
        cut_error = cluster.lod_error;
        // The other clusters the group made share its error: they leave the cut next, on their own.
        if !std::mem::replace(&mut opened[made_by], true) {
            for &child in &groups[made_by].children {
                cut.push(entry(child));
                kept[child] = true;
                triangles += dag[child].triangles();
            }
        }
    }
    let mut cut: Vec<usize> = cut.into_iter().map(|(_, Reverse(slot))| slot).collect();
    cut.sort_unstable();
    Found { kept, opened, cut }
}

/// Cuts the finest detail of `dag` and its `groups` away as `trim` asks (`Trim`), the DAG built
/// over `positions` from the `source` triangles as the build read them: nothing when it cuts
/// nothing. The clusters and groups kept stay in their order, renumbered, their links with them;
/// a group is kept when one of the clusters it made was replaced in the cut, and a cluster when
/// the group that replaces it is kept, or it is a root. Each cluster left in the cut is a leaf:
/// made by no group, its error zero. A group keeps among its outputs only the clusters it made
/// that remain above the cut. Returns the boxes of every cluster the build made, the ones the cut
/// drops included, each as the page that draws it is bounded (`page_extents`), measured before the
/// cut: they set the grid the pages share.
pub fn cut_finest(
    trim: Trim,
    (dag, groups): (&mut Vec<DagCluster>, &mut Vec<DagGroup>),
    positions: &[f32],
    source: &[u32],
) -> Vec<Extent> {
    let extents = page_extents(positions, dag.iter());
    if !trim.cuts() || groups.is_empty() {
        return extents;
    }
    let most_triangles = ((source.len() / 3) as f32 * trim.kept_triangles) as usize;
    let least_error = f64::from(trim.trimmed_error * 0.01 * mesh_size(positions, source));
    let Found { kept, opened, cut } = find_cut(dag, groups, (most_triangles, least_error), 0);
    for slot in cut {
        dag[slot].source = None;
        dag[slot].lod_error = 0.0;
    }
    let (cluster_at, group_at) = (renumbered(&kept), renumbered(&opened));
    *dag = kept_of(std::mem::take(dag), &kept);
    for cluster in dag.iter_mut() {
        cluster.group = cluster.group.and_then(|g| group_at[g]);
        cluster.source = cluster.source.and_then(|g| group_at[g]);
    }
    *groups = kept_of(std::mem::take(groups), &opened);
    for (index, group) in groups.iter_mut().enumerate() {
        group.children = (group.children.iter())
            .filter_map(|&c| cluster_at[c])
            .collect();
        group.outputs = (group.outputs.iter())
            .filter_map(|&c| cluster_at[c])
            .filter(|&c| dag[c].source == Some(index))
            .collect();
    }
    extents
}
