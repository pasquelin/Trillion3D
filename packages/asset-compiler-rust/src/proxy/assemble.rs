//! End of proxy step: world triangles to column-structured format.
use super::{
    bvh, simplify, wide, SceneProxy, PROXY_CELL_METRES, PROXY_ERROR_METRES, PROXY_TRIANGLE_BUDGET,
};

/// Simplifies placed triangles, builds wide BVH, publishes obtained threshold: max
/// requested cut threshold, plus simplification cell addition.
pub(crate) fn assemble(thresholds: &[f64], triangles: Vec<f32>, colours: Vec<u32>) -> SceneProxy {
    assemble_owned(thresholds, triangles, colours, &[], &[])
}

/// The live compiler additionally carries source identity through exactly the same geometry path.
pub(crate) fn assemble_owned(
    thresholds: &[f64],
    mut triangles: Vec<f32>,
    mut colours: Vec<u32>,
    nodes: &[u32],
    worlds: &[[f64; 16]],
) -> SceneProxy {
    // DAG cut stops at root; proxy simplification goes as far as
    // needed, delivering bounded-size triangles to surface cache.
    let cell = simplify::plan_cell(&triangles, PROXY_CELL_METRES, PROXY_TRIANGLE_BUDGET);
    let (sources, mut provenance) = if nodes.is_empty() {
        (Vec::new(), super::provenance::Provenance::default())
    } else {
        super::provenance::collect(&triangles, &colours, nodes, cell)
    };
    let retained = simplify::simplify_sources(&mut triangles, &mut colours, cell);
    let (tree, order) = bvh::build_ordered(&mut triangles, &mut colours);
    let (node_bounds, node_children) = wide::collapse(&tree);
    if !sources.is_empty() {
        provenance.triangle_groups = order.iter().map(|rank| sources[retained[*rank]]).collect();
    }
    if provenance.group_offsets.is_empty() {
        provenance.group_offsets.push(0);
    }
    provenance.source_parents = vec![-1; worlds.len()];
    provenance.bind_worlds = worlds.iter().flatten().copied().collect();
    let cut_error = thresholds
        .iter()
        .copied()
        .fold(PROXY_ERROR_METRES, f64::max);
    SceneProxy {
        bounds: bvh::extent(&triangles),
        error_metres: cut_error + cell * simplify::CELL_ERROR_FACTOR,
        cell_metres: cell,
        triangles,
        albedo: colours,
        node_bounds,
        node_children,
        provenance,
    }
}
