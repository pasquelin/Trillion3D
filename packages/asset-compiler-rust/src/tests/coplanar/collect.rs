use super::*;
use crate::coplanar::plane::ClusterPlane;
use crate::coplanar::{surface, CoplanarBounds, CoplanarInputs, Surface};
use std::collections::{BTreeMap, BTreeSet};

// Behavior 5: collect discards MASK, BLEND and transmission materials, keeping
// max_planes_per_primitive largest areas while counting rest.

/// Minimal compiled primitive: one page per plane, all exact (no "coarse" role).
fn flat_primitive(mesh: usize, material: Option<i64>, planes: usize) -> Value {
    let pages: Vec<Value> = (0..planes)
        .map(|i| json!({"min":[0.0,0.0,0.0],"max":[1.0,1.0,1.0],"id":i}))
        .collect();
    let mut primitive = json!({"mesh":mesh,"pass":"exact-clusters","pages":pages});
    if let Some(id) = material {
        primitive["material"] = json!(id);
    }
    primitive
}

fn scene_with_one_node() -> Value {
    json!({"nodes":[{"mesh":0}],"meshes":[{}],"materials":[
      {},
      {"alphaMode":"MASK"},
      {"alphaMode":"BLEND"},
      {"extensions":{"KHR_materials_transmission":{"transmissionFactor":0.5}}}
    ]})
}

/// Both cases share same one-node scene: only primitive list, planes,
/// offset quantum, and bounds change. Callbacks live here during call.
///
/// `world`, when supplied, is world matrix built by caller (lot B1):
/// `None` makes `collect` rebuild matrix, as before B1.
fn collect_one_node(
    g: &Value,
    primitives: &[Value],
    cluster_planes: &[Vec<Option<ClusterPlane>>],
    offset_quantum: f64,
    bounds: &CoplanarBounds,
    dropped: &mut usize,
    world: Option<&[crate::compiler_world::Mat4]>,
) -> Vec<Surface> {
    let chosen: BTreeSet<usize> = [0].into_iter().collect();
    let mesh_map: BTreeMap<usize, usize> = [(0, 0)].into_iter().collect();
    let source_mesh: BTreeMap<usize, usize> = [(0, 0)].into_iter().collect();
    let cancelled = || Ok(());
    let progress = |_: Value| {};
    let inputs = CoplanarInputs {
        g,
        bin: &[],
        chosen: &chosen,
        mesh_map: &mesh_map,
        source_mesh: &source_mesh,
        primitives,
        cluster_planes,
        offset_quantum,
        cancelled: &cancelled,
        progress: &progress,
    };
    match world {
        Some(world) => surface::collect_with_world(&inputs, bounds, dropped, world),
        None => surface::collect(&inputs, bounds, dropped),
    }
    .expect("collect")
}

#[test]
fn collect_drops_mask_blend_and_transmissive_materials() {
    let g = scene_with_one_node();
    let opaque = flat_primitive(0, None, 1);
    let masked = flat_primitive(0, Some(1), 1);
    let blended = flat_primitive(0, Some(2), 1);
    let transmissive = flat_primitive(0, Some(3), 1);
    let primitives = vec![opaque, masked, blended, transmissive];
    let plane = Some(ClusterPlane {
        normal: [0., 0., 1.],
        offset: 0.0,
        area: 10.0,
    });
    let cluster_planes = vec![vec![plane], vec![plane], vec![plane], vec![plane]];
    let mut dropped = 0usize;
    let surfaces = collect_one_node(
        &g,
        &primitives,
        &cluster_planes,
        0.001,
        &CoplanarBounds::default(),
        &mut dropped,
        None,
    );
    // Only opaque primitive (index 0) passes: MASK, BLEND and transmission discarded.
    assert_eq!(
        surfaces.len(),
        1,
        "MASK, BLEND and transmission must be set aside"
    );
    assert_eq!(surfaces[0].primitive, 0);
}

#[test]
fn collect_keeps_the_largest_areas_per_primitive_and_counts_the_rest() {
    let g = scene_with_one_node();
    // Five pages on five distinct planes (separated offsets), areas 10..50.
    let areas = [10.0, 50.0, 20.0, 40.0, 30.0];
    let pages: Vec<Value> = (0..areas.len())
        .map(|i| json!({"min":[0.0,0.0,0.0],"max":[1.0,1.0,1.0],"id":i}))
        .collect();
    let primitive = json!({"mesh":0,"pass":"exact-clusters","pages":pages});
    let cluster_planes = vec![areas
        .iter()
        .enumerate()
        .map(|(i, area)| {
            Some(ClusterPlane {
                normal: [0., 0., 1.],
                offset: i as f64,
                area: *area,
            })
        })
        .collect::<Vec<_>>()];
    let primitives = vec![primitive];
    let mut dropped = 0usize;
    let bounds = CoplanarBounds {
        max_planes_per_primitive: 3,
        ..CoplanarBounds::default()
    };
    let surfaces = collect_one_node(
        &g,
        &primitives,
        &cluster_planes,
        0.1,
        &bounds,
        &mut dropped,
        None,
    );
    let mut kept: Vec<f64> = surfaces.iter().map(|s| s.area).collect();
    kept.sort_by(|a, b| b.total_cmp(a));
    assert_eq!(
        kept,
        vec![50.0, 40.0, 30.0],
        "only the three largest areas are kept"
    );
    assert_eq!(dropped, 2, "the two smallest are counted as abandoned");
}

// Lot B1: world matrix of mirror node (negative scale), built once by step
// and lent to collect_with_world, yields exact same surfaces bit for bit as old path where
// collect rebuilt it itself.
#[test]
fn collect_with_world_matches_collect_for_a_mirrored_node() {
    let g = json!({"nodes":[{"mesh":0,"scale":[-1.0,1.0,1.0]}],"meshes":[{}],"materials":[]});
    let primitives = vec![flat_primitive(0, None, 1)];
    let plane = Some(ClusterPlane {
        normal: [0., 0., 1.],
        offset: 0.0,
        area: 10.0,
    });
    let cluster_planes = vec![vec![plane]];
    let bounds = CoplanarBounds::default();

    let mut dropped_auto = 0usize;
    let auto = collect_one_node(
        &g,
        &primitives,
        &cluster_planes,
        0.001,
        &bounds,
        &mut dropped_auto,
        None,
    );
    let world = crate::compiler_world::world_matrices(&g).expect("world monde");
    let mut dropped_shared = 0usize;
    let shared = collect_one_node(
        &g,
        &primitives,
        &cluster_planes,
        0.001,
        &bounds,
        &mut dropped_shared,
        Some(&world),
    );

    assert_eq!(dropped_auto, dropped_shared);
    assert_eq!(auto.len(), shared.len());
    assert!(!auto.is_empty(), "the mirrored node must produce a surface");
    for (a, s) in auto.iter().zip(&shared) {
        assert_eq!(a.normal.map(f64::to_bits), s.normal.map(f64::to_bits));
        assert_eq!(a.offset.to_bits(), s.offset.to_bits());
        assert_eq!(a.key, s.key);
        assert_eq!(a.area.to_bits(), s.area.to_bits());
        assert_eq!(a.low.map(f64::to_bits), s.low.map(f64::to_bits));
        assert_eq!(a.high.map(f64::to_bits), s.high.map(f64::to_bits));
        assert_eq!(a.pages, s.pages);
    }
}
