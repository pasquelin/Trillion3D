//! The collision level of one primitive and its tiles.
//!
//! The level is a cut through the DAG at one threshold — the clusters with
//! `lod_error <= threshold < parent_error`, the rule the renderer and the proxy cut by, so the
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
use crate::dag::{CullingNode, DagCluster};
use crate::{hash, object_intact, object_path, store_object, Options, Result};
use rayon::prelude::*;
use serde_json::{json, Value};
use std::collections::HashMap;

/// Most triangles one tile holds: the grain the worker streams by (its bytes stay near 100 kB).
pub(crate) const TILE_TRIANGLES: usize = 4096;

/// The object's collision tolerance, in object units: the median error of its level 1.
pub(crate) fn tolerance(dag: &[DagCluster]) -> f64 {
    let mut errors: Vec<f64> = dag
        .iter()
        .filter(|c| c.level == 1)
        .map(|c| c.lod_error)
        .collect();
    if errors.is_empty() {
        return 0.0;
    }
    let middle = errors.len() / 2;
    *errors.select_nth_unstable_by(middle, f64::total_cmp).1
}

/// The rank range (culling order) a node's subtree owns.
fn range(culling: &[CullingNode], node: usize) -> (usize, usize) {
    let n = &culling[node];
    if n.child_count == 0 {
        return (n.first_cluster, n.first_cluster + n.cluster_count);
    }
    let first = range(culling, n.first_child).0;
    (first, range(culling, n.first_child + n.child_count - 1).1)
}

/// The culling nodes whose collision triangles make one tile each, as rank ranges.
fn tile_ranges(
    culling: &[CullingNode],
    prefix: &[usize],
    node: usize,
    out: &mut Vec<(usize, usize)>,
) {
    let (from, to) = range(culling, node);
    let triangles = prefix[to] - prefix[from];
    let n = &culling[node];
    if triangles == 0 {
        return;
    }
    if triangles <= TILE_TRIANGLES || n.child_count == 0 {
        return out.push((from, to));
    }
    for child in n.first_child..n.first_child + n.child_count {
        tile_ranges(culling, prefix, child, out);
    }
}

/// Stores a cooked shape as a content-addressed object; returns its descriptor.
pub(crate) fn store_shape(o: &Options, bytes: &[u8]) -> Result<Value> {
    let digest = hash(bytes);
    let target = object_path(o, &digest);
    if object_intact(&target, &digest)?.is_none() {
        store_object(&target, bytes)?;
    }
    Ok(json!({"url":format!("../../objects/{digest}.bin"),"sha256":digest,"bytes":bytes.len()}))
}

/// One tile: its triangles gathered, their vertices compacted, cooked and stored.
fn tile(o: &Options, pos: &[f32], triangles: &[u32]) -> Result<Value> {
    let mut remap = HashMap::new();
    let (mut vertices, mut indices) = (Vec::new(), Vec::with_capacity(triangles.len()));
    let (mut min, mut max) = ([f32::MAX; 3], [f32::MIN; 3]);
    for &source in triangles {
        let index = *remap.entry(source).or_insert_with(|| {
            let at = source as usize * 3;
            for a in 0..3 {
                min[a] = min[a].min(pos[at + a]);
                max[a] = max[a].max(pos[at + a]);
            }
            vertices.extend_from_slice(&pos[at..at + 3]);
            (vertices.len() / 3 - 1) as u32
        });
        indices.push(index);
    }
    let mut descriptor = store_shape(o, &mesh_shape(&vertices, &indices)?)?;
    descriptor["triangles"] = json!(indices.len() / 3);
    descriptor["bounds"] = json!([min, max].concat());
    Ok(descriptor)
}

/// The collision triangles of the cut at `threshold`, one list per tile.
fn cut_tiles(
    dag: &[DagCluster],
    order: &[usize],
    culling: &[CullingNode],
    threshold: f64,
) -> Vec<Vec<u32>> {
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
        tile_ranges(culling, &prefix, 0, &mut ranges);
    }
    ranges
        .iter()
        .map(|&(from, to)| (from..to).filter_map(cut).flatten().copied().collect())
        .collect()
}

/// The tiles of a cut whose measured distance to `source` (level 0) holds the tolerance `t`, the
/// coarsest the search finds, and that distance. The cut changes only at a cluster error, so the thresholds tried are
/// those errors: `t` first, then a bisection between the finest that failed and level 0.
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
    let measure = |threshold: f64| {
        let tiles = cut_tiles(dag, order, culling, threshold);
        let hausdorff = hausdorff::distance(pos, source, &tiles.concat());
        (tiles, hausdorff)
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
    best
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
