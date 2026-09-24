//! The collision level of one primitive and its tiles.
//!
//! The level is a cut through the DAG at one tolerance `t` — the clusters with
//! `lod_error <= t < parent_error`, the rule the renderer and the proxy cut by, so the surface is
//! covered once, without a hole: group borders are locked in the DAG. `t` is the object's own:
//! the median error of its first simplified level, the finest step its DAG certifies. A primitive
//! with no simplified level collides at level 0. The distance to level 0 is then measured, not
//! assumed (`hausdorff.rs`), and published.
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

/// The collision of one primitive: a height field when its triangles are a regular grid, else the
/// DAG cut at the object's tolerance in tiles. `source` is level 0, the triangles as drawn.
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
    let cut = |rank: usize| {
        let cluster = &dag[order[rank]];
        crate::proxy::cut::selected(cluster, t).then_some(&cluster.indices)
    };
    let mut prefix = vec![0usize; order.len() + 1];
    for rank in 0..order.len() {
        prefix[rank + 1] = prefix[rank] + cut(rank).map_or(0, |i| i.len() / 3);
    }
    let mut ranges = Vec::new();
    if !culling.is_empty() {
        tile_ranges(culling, &prefix, 0, &mut ranges);
    }
    let gathered: Vec<Vec<u32>> = ranges
        .iter()
        .map(|&(from, to)| (from..to).filter_map(cut).flatten().copied().collect())
        .collect();
    let tiles = gathered
        .par_iter()
        .map(|triangles| tile(o, pos, triangles))
        .collect::<Result<Vec<_>>>()?;
    let all: Vec<u32> = gathered.concat();
    let error = hausdorff::distance(pos, source, &all);
    Ok(json!({"kind":"mesh","tolerance":t,"hausdorff":error,"triangles":all.len()/3,"tiles":tiles}))
}
