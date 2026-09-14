use super::*;
use crate::coplanar::plane::ClusterPlane;
use crate::coplanar::{surface, CoplanarBounds, CoplanarInputs};
use std::collections::{BTreeMap, BTreeSet};

// Comportement 5 : collect écarte les matériaux MASK, BLEND et à transmission, et garde les
// max_planes_per_primitive plus grandes aires en comptant les autres.

/// Une primitive compilée minimale : une page par plan, toutes exactes (pas de rôle "coarse").
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

#[test]
fn collect_drops_mask_blend_and_transmissive_materials() {
  let g = scene_with_one_node();
  let opaque = flat_primitive(0, None, 1);
  let masked = flat_primitive(0, Some(1), 1);
  let blended = flat_primitive(0, Some(2), 1);
  let transmissive = flat_primitive(0, Some(3), 1);
  let primitives = vec![opaque, masked, blended, transmissive];
  let plane = Some(ClusterPlane { normal: [0., 0., 1.], offset: 0.0, area: 10.0 });
  let cluster_planes = vec![vec![plane], vec![plane], vec![plane], vec![plane]];
  let chosen: BTreeSet<usize> = [0].into_iter().collect();
  let mesh_map: BTreeMap<usize, usize> = [(0, 0)].into_iter().collect();
  let source_mesh: BTreeMap<usize, usize> = [(0, 0)].into_iter().collect();
  let cancelled = || Ok(());
  let progress = |_: Value| {};
  let inputs = CoplanarInputs {
    g: &g,
    bin: &[],
    chosen: &chosen,
    mesh_map: &mesh_map,
    source_mesh: &source_mesh,
    primitives: &primitives,
    cluster_planes: &cluster_planes,
    offset_quantum: 0.001,
    cancelled: &cancelled,
    progress: &progress,
  };
  let mut dropped = 0usize;
  let surfaces = surface::collect(&inputs, &CoplanarBounds::default(), &mut dropped).expect("collect");
  // Seule la primitive opaque (index 0) passe : MASK, BLEND et transmission sont écartés.
  assert_eq!(surfaces.len(), 1, "MASK, BLEND et transmission doivent être écartés");
  assert_eq!(surfaces[0].primitive, 0);
}

#[test]
fn collect_keeps_the_largest_areas_per_primitive_and_counts_the_rest() {
  let g = scene_with_one_node();
  // Cinq pages sur cinq plans distincts (offsets écartés), aires 10..50.
  let areas = [10.0, 50.0, 20.0, 40.0, 30.0];
  let pages: Vec<Value> = (0..areas.len())
    .map(|i| json!({"min":[0.0,0.0,0.0],"max":[1.0,1.0,1.0],"id":i}))
    .collect();
  let primitive = json!({"mesh":0,"pass":"exact-clusters","pages":pages});
  let cluster_planes = vec![areas
    .iter()
    .enumerate()
    .map(|(i, area)| Some(ClusterPlane { normal: [0., 0., 1.], offset: i as f64, area: *area }))
    .collect::<Vec<_>>()];
  let primitives = vec![primitive];
  let chosen: BTreeSet<usize> = [0].into_iter().collect();
  let mesh_map: BTreeMap<usize, usize> = [(0, 0)].into_iter().collect();
  let source_mesh: BTreeMap<usize, usize> = [(0, 0)].into_iter().collect();
  let cancelled = || Ok(());
  let progress = |_: Value| {};
  let inputs = CoplanarInputs {
    g: &g,
    bin: &[],
    chosen: &chosen,
    mesh_map: &mesh_map,
    source_mesh: &source_mesh,
    primitives: &primitives,
    cluster_planes: &cluster_planes,
    offset_quantum: 0.1,
    cancelled: &cancelled,
    progress: &progress,
  };
  let mut dropped = 0usize;
  let bounds = CoplanarBounds { max_planes_per_primitive: 3, ..CoplanarBounds::default() };
  let surfaces = surface::collect(&inputs, &bounds, &mut dropped).expect("collect");
  let mut kept: Vec<f64> = surfaces.iter().map(|s| s.area).collect();
  kept.sort_by(|a, b| b.total_cmp(a));
  assert_eq!(kept, vec![50.0, 40.0, 30.0], "seules les trois plus grandes aires sont gardées");
  assert_eq!(dropped, 2, "les deux plus petites sont comptées comme abandonnées");
}
