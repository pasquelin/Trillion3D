//! The collision level of one primitive and its tiles.
//!
//! The level is a cut through the DAG at one threshold — the clusters with
//! `lod_error <= threshold < parent_error`, the rule the renderer cuts by, so the
//! surface is covered once, without a hole: group borders are locked in the DAG. The object's
//! tolerance `t` is its own: the median error of its first simplified level, the finest step its
//! DAG certifies. A cluster's error is the simplifier's estimate, not a bound, so the distance of a
//! cut to level 0 is measured (`hausdorff.rs`): the collider is a cut at or under `t` whose measure
//! holds `t`, the coarsest a bisection over the cluster errors finds, level 0 holding any. A
//! primitive with no simplified level collides at level 0.
//!
//! Tiles follow the culling hierarchy: a node whose collision triangles fit `TILE_TRIANGLES` is
//! one tile, a larger one hands its children down. Each tile is a Jolt `MeshShape` in object space,
//! stored under the SHA-256 of its bytes like a page.
use super::{hausdorff, height, mesh_shape};
use crate::dag::DagCluster;
use crate::{Options, Result};
use rayon::prelude::*;
use serde_json::{json, Value};
use trillion3d_math::geometry::aabb::aabb_of_f32;
use trillion3d_page_codec::culling::CullingNode;
use trillion3d_page_codec::encode::vertices::first_use;

/// Most triangles one tile holds: the grain the worker streams by (its bytes stay near 100 kB).
pub(crate) const TILE_TRIANGLES: usize = 4096;

/// The object's collision tolerance, in object units: the median error of its level 1, the upper
/// one of an even count (rank `len / 2` in `total_cmp` order): of the two, the coarser, whose cut
/// is the lighter collider the measure still holds it to.
pub(crate) fn tolerance(dag: &[DagCluster]) -> f64 {
    let mut errors: Vec<f64> = dag
        .iter()
        .filter(|c| c.level == 1)
        .map(|c| c.lod_error)
        .collect();
    if errors.is_empty() {
        return 0.0;
    }
    let upper = errors.len() / 2;
    *errors.select_nth_unstable_by(upper, f64::total_cmp).1
}

/// The ranks a leaf owns, none for a node with children or without clusters.
fn leaf_range(n: &CullingNode) -> Option<(usize, usize)> {
    (n.child_count == 0 && n.cluster_count > 0)
        .then(|| (n.first_cluster, n.first_cluster + n.cluster_count))
}

/// The rank ranges (culling order) of the leaves of a node's subtree, its group parts: a subtree
/// owns no one range, its parts lie where the page assignment laid them.
fn leaf_ranges(culling: &[CullingNode], node: usize, out: &mut Vec<(usize, usize)>) {
    let n = &culling[node];
    if n.child_count == 0 {
        out.extend(leaf_range(n));
        return;
    }
    for child in n.first_child..n.first_child + n.child_count {
        leaf_ranges(culling, child, out);
    }
}

/// The collision triangles of every subtree of the culling hierarchy under `node`, into `counts`
/// (`prefix` counting them by rank): each subtree is walked once.
fn subtree_triangles(
    culling: &[CullingNode],
    prefix: &[usize],
    node: usize,
    counts: &mut [usize],
) -> usize {
    let n = &culling[node];
    counts[node] = if n.child_count == 0 {
        leaf_range(n).map_or(0, |(from, to)| prefix[to] - prefix[from])
    } else {
        (n.first_child..n.first_child + n.child_count)
            .map(|child| subtree_triangles(culling, prefix, child, counts))
            .sum()
    };
    counts[node]
}

/// The culling nodes whose collision triangles (`counts`) make one tile each, each as its leaves'
/// rank ranges.
fn tile_ranges(
    culling: &[CullingNode],
    counts: &[usize],
    node: usize,
    out: &mut Vec<Vec<(usize, usize)>>,
) {
    let triangles = counts[node];
    let n = &culling[node];
    if triangles == 0 {
        return;
    }
    if triangles <= TILE_TRIANGLES || n.child_count == 0 {
        let mut ranges = Vec::new();
        leaf_ranges(culling, node, &mut ranges);
        return out.push(ranges);
    }
    for child in n.first_child..n.first_child + n.child_count {
        tile_ranges(culling, counts, child, out);
    }
}

/// Stores a cooked shape as a content-addressed object; returns its descriptor.
pub(crate) fn store_shape(o: &Options, bytes: &[u8]) -> Result<Value> {
    Ok(crate::compiler::cache::storage::store_descriptor(o, bytes)?.0)
}

/// One tile: its triangles gathered, their vertices compacted, cooked and stored.
fn tile(o: &Options, pos: &[f32], triangles: &[u32]) -> Result<Value> {
    let (used, indices) = first_use(triangles.iter().copied());
    let mut vertices = Vec::with_capacity(used.len() * 3);
    for source in used {
        let at = source as usize * 3;
        vertices.extend_from_slice(&pos[at..at + 3]);
    }
    let (min, max) = aabb_of_f32(vertices.as_chunks::<3>().0.iter().copied());
    let mut descriptor = store_shape(o, &mesh_shape(&vertices, &indices)?)?;
    descriptor["triangles"] = json!(indices.len() / 3);
    descriptor["bounds"] = json!([min, max].concat());
    Ok(descriptor)
}

/// The collision triangles of the cut at `threshold`, tile after tile in one list, and where each
/// tile's end stands in it.
fn cut_tiles(
    dag: &[DagCluster],
    order: &[usize],
    culling: &[CullingNode],
    threshold: f64,
) -> (Vec<u32>, Vec<usize>) {
    let cut = |rank: usize| {
        let cluster = &dag[order[rank]];
        crate::proxy::cut::selected(cluster, threshold).then_some(&cluster.indices)
    };
    let mut prefix = vec![0usize; order.len() + 1];
    for rank in 0..order.len() {
        prefix[rank + 1] = prefix[rank] + cut(rank).map_or(0, |i| i.len() / 3);
    }
    let mut ranges = Vec::new();
    if !culling.is_empty() {
        let mut counts = vec![0usize; culling.len()];
        subtree_triangles(culling, &prefix, 0, &mut counts);
        tile_ranges(culling, &counts, 0, &mut ranges);
    }
    let mut flat = Vec::with_capacity(prefix[order.len()] * 3);
    let mut ends = Vec::with_capacity(ranges.len());
    for tile in &ranges {
        for &(from, to) in tile {
            for indices in (from..to).filter_map(cut) {
                flat.extend_from_slice(indices);
            }
        }
        ends.push(flat.len());
    }
    (flat, ends)
}

/// `flat` cut into the tiles that end at `ends`.
fn tiles_of(flat: &[u32], ends: &[usize]) -> Vec<Vec<u32>> {
    let mut from = 0;
    ends.iter()
        .map(|&end| {
            let tile = flat[from..end].to_vec();
            from = end;
            tile
        })
        .collect()
}

/// The tiles of a cut whose measured distance to `source` (level 0) holds the tolerance `t`, the
/// coarsest the search finds, and that distance. The cut changes only at a cluster error, so the
/// thresholds tried are those errors: `t` first, then a bisection between the coarsest threshold
/// that failed and level 0.
pub(crate) fn collision_cut(
    dag: &[DagCluster],
    order: &[usize],
    culling: &[CullingNode],
    pos: &[f32],
    source: &[u32],
    t: f64,
) -> (Vec<Vec<u32>>, f64) {
    let mut thresholds: Vec<f64> = dag
        .iter()
        .map(|c| c.lod_error)
        .filter(|&e| e <= t)
        .chain([0.0])
        .collect();
    thresholds.sort_by(f64::total_cmp);
    thresholds.dedup();
    let level0 = hausdorff::Level0::new(pos, source);
    let measure = |threshold: f64| {
        let (flat, ends) = cut_tiles(dag, order, culling, threshold);
        let hausdorff = level0.distance(&flat, 0.0);
        ((flat, ends), hausdorff)
    };
    let (mut held, mut failed) = (0, thresholds.len() - 1);
    let mut best = measure(thresholds[failed]);
    if best.1 > t && failed > held {
        best = measure(thresholds[held]);
        while failed - held > 1 {
            let middle = (held + failed) / 2;
            let tried = measure(thresholds[middle]);
            if tried.1 <= t {
                (held, best) = (middle, tried);
            } else {
                failed = middle;
            }
        }
    }
    let ((flat, ends), hausdorff) = best;
    (tiles_of(&flat, &ends), hausdorff)
}

/// The collision of one primitive: a height field when its triangles are a regular grid, else the
/// collision cut in tiles. `source` is level 0, the triangles as drawn.
pub(crate) fn cook_primitive(
    o: &Options,
    dag: &[DagCluster],
    order: &[usize],
    culling: &[CullingNode],
    pos: &[f32],
    source: &[u32],
) -> Result<Value> {
    if let Some(grid) = height::detect(pos, source) {
        return height::cook(o, &grid);
    }
    let t = tolerance(dag);
    let (gathered, error) = collision_cut(dag, order, culling, pos, source, t);
    let tiles = gathered
        .par_iter()
        .map(|triangles| tile(o, pos, triangles))
        .collect::<Result<Vec<_>>>()?;
    let triangles = gathered.iter().map(Vec::len).sum::<usize>() / 3;
    Ok(json!({"kind":"mesh","tolerance":t,"hausdorff":error,"triangles":triangles,"tiles":tiles}))
}
